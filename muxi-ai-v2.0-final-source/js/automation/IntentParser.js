// 本地固定指令解析器：只使用关键词和正则，不调用任何远程模型。
const RULES = [
  { intent: "navigate_settings", label: "打开设置", confidence: 1, patterns: [/^(?:请)?打开设置(?:页面)?[。！!？?\s]*$/] },
  { intent: "navigate_chat", label: "打开聊天", confidence: 1, patterns: [/^(?:请)?打开聊天(?:页面)?[。！!？?\s]*$/] },
  { intent: "open_muxi", label: "打开暮曦", confidence: 1, patterns: [/^(?:请)?打开暮曦(?:\s*AI)?[。！!？?\s]*$/i] },
  { intent: "copy_start_command", label: "复制启动命令", confidence: 1, patterns: [/^复制(?:暮曦)?启动命令[。！!？?\s]*$/] },
  { intent: "generate_termux_start", label: "生成 Termux 启动命令", confidence: 1, patterns: [/^生成(?:启动暮曦的)?\s*Termux\s*命令[。！!？?\s]*$/i, /^生成.*Termux.*启动.*暮曦/i] },
  { intent: "view_automation_history", label: "查看自动化历史", confidence: 1, patterns: [/^(?:查看|打开)自动化(?:任务)?历史(?:记录)?[。！!？?\s]*$/] },
  { intent: "stop_current_task", label: "停止当前任务", confidence: 1, patterns: [/^(?:停止|取消|终止)当前任务[。！!？?\s]*$/] },
  { intent: "clear_automation_history", label: "清空任务记录", confidence: 1, patterns: [/^(?:清空|删除)自动化?(?:任务)?(?:历史)?记录[。！!？?\s]*$/, /^清空任务记录[。！!？?\s]*$/] },
  { intent: "unzip_latest_muxi", label: "解压最新暮曦 ZIP", confidence: 1, patterns: [/^解压最新的?暮曦(?:\s*AI)?\s*(?:ZIP|压缩包)[。！!？?\s]*$/i] },
  { intent: "start_muxi", label: "启动暮曦", confidence: 0.98, patterns: [/^(?:启动|运行)暮曦(?:\s*AI)?[。！!？?\s]*$/i] },
  { intent: "check_muxi_service", label: "检查暮曦服务", confidence: 0.98, patterns: [/^(?:检查|检测|查看)暮曦(?:本地)?服务(?:状态)?[。！!？?\s]*$/] },
  { intent: "restart_muxi", label: "重启暮曦", confidence: 0.98, patterns: [/^重新?启动暮曦(?:\s*AI)?[。！!？?\s]*$/i, /^重启暮曦(?:\s*AI)?[。！!？?\s]*$/i] },
  { intent: "deploy_new_version", label: "部署新版", confidence: 0.98, patterns: [/^(?:部署|更新|安装)暮曦(?:\s*AI)?(?:新版本|新版|更新包)[。！!？?\s]*$/i, /^部署新版[。！!？?\s]*$/] },
  { intent: "unsupported_delete_file", label: "删除文件（未开放）", confidence: 0.95, patterns: [/(?:删除|清除).*(?:文件|目录|文件夹)/] },
  { intent: "unsupported_install_app", label: "安装应用（未开放）", confidence: 0.95, patterns: [/(?:安装|静默安装).*(?:应用|APP|APK)/i] },
  { intent: "unsupported_send_message", label: "发送消息（未开放）", confidence: 0.95, patterns: [/(?:发送|替我发).*(?:消息|短信|微信)/] },
  { intent: "unsupported_payment", label: "付款（未开放）", confidence: 0.95, patterns: [/(?:付款|支付|转账|收款)/] },
  { intent: "unsupported_system_change", label: "修改系统设置（未开放）", confidence: 0.95, patterns: [/(?:修改|更改|开启|关闭).*(?:系统设置|系统权限|授权)/] },
  { intent: "unsupported_shell", label: "任意 Shell（未开放）", confidence: 0.95, patterns: [/(?:^|\s)(?:rm|su|chmod|wget|adb)\b/i, /curl\s+.+\|/i, /执行.*(?:Shell|命令|脚本)/i] },
];

function createId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export class IntentParser {
  normalize(text) {
    return String(text || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  }

  parse(text) {
    const rawText = String(text || "");
    const normalizedText = this.normalize(rawText);
    for (const rule of RULES) {
      if (rule.patterns.some((pattern) => pattern.test(normalizedText))) {
        return {
          id: createId("intent"),
          intent: rule.intent,
          label: rule.label,
          confidence: rule.confidence,
          rawText,
          normalizedText,
          slots: {},
          source: "local_rule",
        };
      }
    }
    return {
      id: createId("intent"),
      intent: "unknown",
      label: "未识别指令",
      confidence: 0,
      rawText,
      normalizedText,
      slots: {},
      source: "local_rule",
    };
  }
}

