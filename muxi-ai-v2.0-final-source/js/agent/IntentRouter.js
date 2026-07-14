import { ExecutorStatus } from "./AgentExecutor.js";
import { TaskStatus, isTerminalTaskStatus } from "./Task.js";
import { ToolRiskLevel } from "../tools/Tool.js";

export const IntentRouteSource = Object.freeze({
  DEFAULT_RULE: "default_rule",
  CUSTOM_RULE: "custom_rule",
  NONE: "none",
});

export const IntentRouterStatus = Object.freeze({
  UNMATCHED: "unmatched",
  PENDING: "pending",
  WAITING_CONFIRMATION: "waiting_confirmation",
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
  BLOCKED: "blocked",
  CANCELLED: "cancelled",
});

// Sprint 06 默认规则只判断应交给哪一类 Tool；具体动作仍由 Tool 自己解析和校验。
export const DEFAULT_INTENT_ROUTES = Object.freeze([
  {
    id: "default-automation-high-risk",
    intent: "restricted_automation_request",
    toolName: "automation",
    description: "交给自动化安全层识别并阻止未开放的高风险请求",
    priority: 100,
    patterns: [
      /(?:删除|清除).*(?:文件|目录|文件夹)/i,
      /(?:安装|静默安装).*(?:应用|app|apk)/i,
      /(?:发送|替我发).*(?:消息|短信|微信)/i,
      /(?:付款|支付|转账|收款)/i,
      /(?:修改|更改|开启|关闭).*(?:系统设置|系统权限|授权)/i,
      /(?:^|\s)(?:rm|su|chmod|wget|adb)\b/i,
      /执行.*(?:shell|命令|脚本)/i,
    ],
  },
  {
    id: "default-automation-navigation",
    intent: "page_navigation",
    toolName: "automation",
    description: "页面和暮曦入口导航",
    priority: 80,
    patterns: [/(?:打开|进入|前往)(?:设置|聊天|暮曦(?:\s*AI)?)/i],
  },
  {
    id: "default-automation-history",
    intent: "automation_history",
    toolName: "automation",
    description: "自动化历史与当前任务管理",
    priority: 70,
    patterns: [
      /(?:查看|打开|清空|删除).*(?:自动化|任务).*(?:历史|记录)/i,
      /(?:停止|取消|终止)当前任务/i,
      /清空任务记录/i,
    ],
  },
  {
    id: "default-automation-command",
    intent: "local_command_assistance",
    toolName: "automation",
    description: "本地命令复制、生成与安全操作建议",
    priority: 60,
    patterns: [
      /(?:复制|生成).*(?:启动命令|termux)/i,
      /解压.*暮曦.*(?:zip|压缩包)/i,
    ],
  },
  {
    id: "default-automation-service",
    intent: "muxi_service_management",
    toolName: "automation",
    description: "暮曦本地服务检查和人工辅助操作",
    priority: 50,
    patterns: [/(?:启动|运行|重启|重新启动|检查|检测|部署|更新).*(?:暮曦|本地服务|新版)/i],
  },
]);

function cloneValue(value) {
  if (value === undefined) return null;
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(value);
    } catch {
      // RegExp 和函数不会出现在对外结果中，失败时回退到 JSON 数据。
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeInput(input) {
  return String(input || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizePatterns(patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) throw new Error("Intent 路由规则至少需要一个 pattern");
  return patterns.map((pattern) => {
    if (pattern instanceof RegExp) return pattern;
    const text = String(pattern || "").trim();
    if (!text) throw new Error("Intent 路由 pattern 不能为空");
    return new RegExp(text, "i");
  });
}

function normalizeRule(definition, source, order) {
  const id = String(definition?.id || "").trim();
  const intent = String(definition?.intent || "").trim();
  const toolName = String(definition?.toolName || definition?.taskType || "").trim();
  if (!id) throw new Error("Intent 路由规则缺少 id");
  if (!intent) throw new Error(`Intent 路由规则 ${id} 缺少 intent`);
  if (!toolName) throw new Error(`Intent 路由规则 ${id} 缺少 toolName`);
  return {
    id,
    intent,
    toolName,
    description: String(definition.description || ""),
    priority: Number.isFinite(Number(definition.priority)) ? Number(definition.priority) : 0,
    confidence: Math.max(0, Math.min(1, Number(definition.confidence ?? 1))),
    patterns: normalizePatterns(definition.patterns),
    extractParams: typeof definition.extractParams === "function" ? definition.extractParams : null,
    source,
    order,
  };
}

function publicRule(rule) {
  return {
    id: rule.id,
    intent: rule.intent,
    toolName: rule.toolName,
    description: rule.description,
    priority: rule.priority,
    confidence: rule.confidence,
    patterns: rule.patterns.map((pattern) => ({ source: pattern.source, flags: pattern.flags })),
    source: rule.source,
  };
}

function createUnmatchedResult(rawText, normalizedText, reason) {
  return {
    matched: false,
    intent: "unknown",
    taskType: null,
    toolName: null,
    confidence: 0,
    params: {},
    rawText,
    normalizedText,
    ruleId: null,
    source: IntentRouteSource.NONE,
    reason,
  };
}

function executionToRouterStatus(execution) {
  if (execution?.status === ExecutorStatus.SUCCESS) return IntentRouterStatus.SUCCESS;
  if (execution?.status === ExecutorStatus.CANCELLED) return IntentRouterStatus.CANCELLED;
  return IntentRouterStatus.FAILED;
}

// 本地 Intent Router：规则识别 -> Agent Task -> Executor -> Tool。
export class IntentRouter {
  constructor({ agentCore, executor, rules = [], useDefaultRules = true, taskFactory } = {}) {
    if (!agentCore || typeof agentCore.createTask !== "function" || typeof agentCore.getTask !== "function") {
      throw new Error("IntentRouter 需要 AgentCore 实例");
    }
    if (!executor || typeof executor.executeTask !== "function" || typeof executor.getTools !== "function") {
      throw new Error("IntentRouter 需要 AgentExecutor 实例");
    }
    this.agentCore = agentCore;
    this.executor = executor;
    this.taskFactory = typeof taskFactory === "function" ? taskFactory : null;
    this.rules = new Map();
    this.nextOrder = 0;

    if (useDefaultRules) {
      for (const rule of DEFAULT_INTENT_ROUTES) this.registerRule(rule, IntentRouteSource.DEFAULT_RULE);
    }
    for (const rule of rules) this.registerRule(rule, IntentRouteSource.CUSTOM_RULE);
  }

  registerRule(definition, source = IntentRouteSource.CUSTOM_RULE) {
    const normalizedSource = source === IntentRouteSource.DEFAULT_RULE
      ? IntentRouteSource.DEFAULT_RULE
      : IntentRouteSource.CUSTOM_RULE;
    const rule = normalizeRule(definition, normalizedSource, this.nextOrder++);
    if (this.rules.has(rule.id)) throw new Error(`Intent 路由规则 ${rule.id} 已存在`);
    this.rules.set(rule.id, rule);
    return cloneValue(publicRule(rule));
  }

  unregisterRule(ruleId) {
    return this.rules.delete(String(ruleId || "").trim());
  }

  getRules() {
    return this.getSortedRules().map((rule) => cloneValue(publicRule(rule)));
  }

  getSortedRules() {
    return [...this.rules.values()].sort((left, right) => right.priority - left.priority || left.order - right.order);
  }

  recognize(input) {
    const rawText = String(input || "");
    const normalizedText = normalizeInput(rawText);
    if (!normalizedText) return createUnmatchedResult(rawText, normalizedText, "empty_input");

    for (const rule of this.getSortedRules()) {
      for (const pattern of rule.patterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(normalizedText);
        pattern.lastIndex = 0;
        if (!match) continue;

        let params = {};
        if (rule.extractParams) {
          params = rule.extractParams({ match, input: rawText, normalizedText });
          if (!params || typeof params !== "object" || Array.isArray(params)) {
            throw new Error(`Intent 路由规则 ${rule.id} 的 extractParams() 必须返回对象`);
          }
        }
        return cloneValue({
          matched: true,
          intent: rule.intent,
          taskType: rule.toolName,
          toolName: rule.toolName,
          confidence: rule.confidence,
          params,
          rawText,
          normalizedText,
          ruleId: rule.id,
          source: rule.source,
          reason: "",
        });
      }
    }
    return createUnmatchedResult(rawText, normalizedText, "no_matching_rule");
  }

  getToolMetadata(toolName) {
    return this.executor.getTools().find((tool) => tool.name === toolName) || null;
  }

  createTask(input, { metadata = {}, params = {} } = {}) {
    const route = this.recognize(input);
    if (!route.matched) return { route, task: null };

    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new Error("IntentRouter params 必须是对象");
    }

    const tool = this.getToolMetadata(route.toolName);
    if (!tool) {
      const error = new Error(`Intent 已识别，但工具 ${route.toolName} 未注册`);
      error.code = "ROUTED_TOOL_NOT_FOUND";
      throw error;
    }

    const specification = {
      kind: route.toolName,
      input: route.normalizedText,
      parsed: route,
      actions: [],
      riskLevel: tool.riskLevel,
      requiresConfirmation: tool.riskLevel === ToolRiskLevel.MEDIUM,
      status: tool.riskLevel === ToolRiskLevel.HIGH
        ? TaskStatus.BLOCKED
        : tool.riskLevel === ToolRiskLevel.MEDIUM
          ? TaskStatus.WAITING_CONFIRMATION
          : TaskStatus.PENDING,
      error: tool.riskLevel === ToolRiskLevel.HIGH ? "HIGH 风险工具当前版本未开放" : "",
      metadata: {
        ...cloneValue(metadata || {}),
        source: route.source,
        routeRuleId: route.ruleId,
        routeIntent: route.intent,
        toolParams: {
          ...route.params,
          ...cloneValue(params),
        },
      },
    };

    const customTask = this.taskFactory?.(cloneValue(route), cloneValue(specification));
    const task = customTask || this.agentCore.createTask(specification);
    if (!task?.id || !this.agentCore.getTask(task.id)) {
      throw new Error("IntentRouter taskFactory 必须返回已注册到 AgentCore 的 Task");
    }
    return { route, task: this.agentCore.getTask(task.id) };
  }

  async executeTask(taskId, { confirmed = false, context = {}, route = null } = {}) {
    let task = this.agentCore.getTask(String(taskId || "").trim());
    if (!task) throw new Error("任务不存在或已经失效");
    if (task.status === TaskStatus.BLOCKED) {
      return { matched: true, status: IntentRouterStatus.BLOCKED, route, task, execution: null };
    }
    if (task.status === TaskStatus.CANCELLED) {
      return { matched: true, status: IntentRouterStatus.CANCELLED, route, task, execution: null };
    }
    if (task.requiresConfirmation && !confirmed) {
      return { matched: true, status: IntentRouterStatus.WAITING_CONFIRMATION, route, task, execution: null };
    }
    if (isTerminalTaskStatus(task.status)) {
      return {
        matched: true,
        status: task.status === TaskStatus.COMPLETED ? IntentRouterStatus.SUCCESS : IntentRouterStatus.FAILED,
        route,
        task,
        execution: this.executor.getExecution(task.id),
      };
    }

    this.agentCore.transitionTask(task.id, TaskStatus.RUNNING);
    const normalizedContext = context && typeof context === "object" ? context : {};
    const execution = await this.executor.executeTask(task.id, {
      ...normalizedContext,
      confirmed: Boolean(confirmed),
    });
    task = this.agentCore.getTask(task.id);

    if (!isTerminalTaskStatus(task.status)) {
      const nextStatus = execution.status === ExecutorStatus.SUCCESS
        ? TaskStatus.COMPLETED
        : execution.status === ExecutorStatus.CANCELLED
          ? TaskStatus.CANCELLED
          : TaskStatus.FAILED;
      task = this.agentCore.transitionTask(task.id, nextStatus, { error: execution.error || "" });
    }
    return {
      matched: true,
      status: executionToRouterStatus(execution),
      route,
      task,
      execution,
    };
  }

  async dispatch(input, options = {}) {
    const created = this.createTask(input, options);
    if (!created.task) {
      return {
        matched: false,
        status: IntentRouterStatus.UNMATCHED,
        route: created.route,
        task: null,
        execution: null,
      };
    }
    return this.executeTask(created.task.id, { ...options, route: created.route });
  }
}
