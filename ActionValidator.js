// 动作安全校验器：风险等级和命令白名单在执行前后都会检查。
export const RISK_LEVELS = Object.freeze({ LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" });

const LOW_TYPES = new Set(["navigate", "show_message", "wait", "copy_text", "cancel_task"]);
const MEDIUM_TYPES = new Set(["open_url", "create_termux_command", "open_app_request", "clear_automation_history"]);
const HIGH_TYPES = new Set(["delete_file", "install_app", "send_message", "payment", "modify_system_settings", "execute_shell"]);
const STATUSES = new Set(["pending", "waiting_confirmation", "running", "completed", "external_required", "blocked", "failed", "cancelled"]);
const ROUTES = new Set(["home", "chat", "memory", "automation", "settings"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateURL(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function commandSegments(command) {
  const value = String(command || "").trim().replace(/\s+/g, " ");
  if (!value || value.length > 300 || /[\r\n;|`<>]/.test(value) || /\$\(/.test(value)) return null;
  if (/(?:^|\s)(?:rm|su|chmod|wget|adb|nc|nmap|scp|ssh)\b/i.test(value)) return null;
  if (/\bcurl\b.*(?:\||\bsh\b|\bbash\b)/i.test(value)) return null;
  if (/(^|[^&])&([^&]|$)/.test(value)) return null;
  return value.split(/\s*&&\s*/).filter(Boolean);
}

function isAllowedSegment(segment) {
  if (/^pwd$/.test(segment)) return true;
  if (/^npm (?:install|start)$/.test(segment)) return true;
  if (/^pkill node$/.test(segment)) return true;
  if (/^curl http:\/\/127\.0\.0\.1:8787\/?$/.test(segment)) return true;
  if (/^cd \/storage\/emulated\/0\/Download\/[\p{L}\p{N}._/-]+$/u.test(segment)) return true;
  if (/^ls(?: \/storage\/emulated\/0\/Download(?:\/[\p{L}\p{N}._/-]+)?)?$/u.test(segment)) return true;
  if (/^node(?: [\p{L}\p{N}._/-]+\.m?js)?$/u.test(segment)) return true;
  return false;
}

export function isAllowedTermuxCommand(command) {
  const segments = commandSegments(command);
  return Boolean(segments?.length) && segments.every(isAllowedSegment);
}

export class ActionValidator {
  riskFor(action) {
    if (HIGH_TYPES.has(action?.type)) return RISK_LEVELS.HIGH;
    if (MEDIUM_TYPES.has(action?.type)) return RISK_LEVELS.MEDIUM;
    return RISK_LEVELS.LOW;
  }

  validate(action) {
    const errors = [];
    if (!isObject(action)) errors.push("Action 必须是对象");
    if (!String(action?.id || "").startsWith("action-")) errors.push("Action id 无效");
    if (!String(action?.type || "")) errors.push("Action type 不能为空");
    if (!isObject(action?.params)) errors.push("Action params 必须是对象");
    if (typeof action?.requiresConfirmation !== "boolean") errors.push("requiresConfirmation 必须是布尔值");
    if (!STATUSES.has(action?.status)) errors.push("Action status 无效");

    const riskLevel = this.riskFor(action);
    if (![...LOW_TYPES, ...MEDIUM_TYPES, ...HIGH_TYPES].includes(action?.type)) errors.push("不支持的 Action type");

    switch (action?.type) {
      case "navigate":
        if (!ROUTES.has(action.params.route)) errors.push("不允许导航到该页面");
        break;
      case "show_message":
        if (!String(action.params.text || "").trim()) errors.push("提示文本不能为空");
        break;
      case "wait": {
        const milliseconds = Number(action.params.milliseconds);
        if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 30000) errors.push("等待时间必须在 0 到 30000 毫秒之间");
        break;
      }
      case "copy_text":
        if (!String(action.params.text || "").trim() || String(action.params.text).length > 2000) errors.push("复制文本无效");
        if (action.params.contentType === "safe_command" && !isAllowedTermuxCommand(action.params.text)) errors.push("复制命令不在白名单内");
        break;
      case "open_url":
        if (!validateURL(action.params.url)) errors.push("URL 无效或协议不安全");
        break;
      case "create_termux_command":
        if (!isAllowedTermuxCommand(action.params.command)) errors.push("Termux 命令不在白名单内");
        break;
      case "open_app_request":
        if (action.params.packageName !== "com.termux" || action.params.appName !== "Termux") errors.push("当前只允许生成 Termux 打开请求");
        break;
      case "clear_automation_history":
        if (action.params.scope !== "automation_only") errors.push("只能清除自动化历史");
        break;
      case "cancel_task":
        if (action.params.scope !== "current") errors.push("只能停止当前任务");
        break;
      default:
        break;
    }

    const blocked = riskLevel === RISK_LEVELS.HIGH || errors.length > 0;
    if (riskLevel === RISK_LEVELS.HIGH) errors.push("HIGH 风险动作在当前版本未开放，不会实际执行");
    const normalizedAction = {
      ...action,
      requiresConfirmation: action.requiresConfirmation || riskLevel !== RISK_LEVELS.LOW,
      status: blocked ? "blocked" : action.status,
      riskLevel,
      validationErrors: [...new Set(errors)],
    };
    return { valid: errors.length === 0, blocked, riskLevel, errors: normalizedAction.validationErrors, action: normalizedAction };
  }

  validatePlan(actions) {
    const results = (Array.isArray(actions) ? actions : []).map((item) => this.validate(item));
    const rank = { LOW: 1, MEDIUM: 2, HIGH: 3 };
    const highestRisk = results.reduce((highest, item) => rank[item.riskLevel] > rank[highest] ? item.riskLevel : highest, RISK_LEVELS.LOW);
    return {
      results,
      highestRisk,
      requiresConfirmation: results.some((item) => item.action.requiresConfirmation),
      blocked: !results.length || results.some((item) => item.blocked),
      valid: Boolean(results.length) && results.every((item) => item.valid),
    };
  }
}

