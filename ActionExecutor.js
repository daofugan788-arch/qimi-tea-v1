// PWA 执行器只执行网页内能力。Android 系统动作一律返回 external_required。
function abortError() {
  return new DOMException("任务已取消", "AbortError");
}

function wait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}

export class ActionExecutor {
  constructor({ navigate, showMessage, openURL, copyText, repository } = {}) {
    this.navigate = navigate || (() => {});
    this.showMessage = showMessage || (() => {});
    this.openURL = openURL || ((url) => globalThis.open?.(url, "_blank", "noopener"));
    this.copyText = copyText || ((text) => globalThis.navigator?.clipboard?.writeText?.(text));
    this.repository = repository;
  }

  async execute(action, { signal } = {}) {
    if (signal?.aborted) throw abortError();
    switch (action.type) {
      case "navigate":
        this.navigate(action.params.route, action.params);
        return { status: "completed", message: "页面导航完成" };
      case "show_message":
        this.showMessage(action.params.text);
        return { status: "completed", message: action.params.text };
      case "wait":
        await wait(Number(action.params.milliseconds), signal);
        return { status: "completed", message: "等待完成" };
      case "copy_text":
        await this.copyText(action.params.text);
        return { status: "completed", message: "文本已复制" };
      case "open_url":
        this.openURL(action.params.url);
        return { status: "completed", message: "已发起打开网页，不代表本地服务一定在线" };
      case "create_termux_command":
        return { status: "external_required", message: "需要在步骤卡片中复制，并到 Termux 手动运行", externalExecutor: "Termux" };
      case "open_app_request":
        return { status: "external_required", message: `请手动打开${action.params.appName}；PWA 未控制 Android 应用`, externalExecutor: "future_android" };
      case "clear_automation_history":
        this.repository?.clearHistory?.();
        return { status: "completed", message: "自动化历史已清空" };
      case "cancel_task":
        return { status: "completed", message: "已提交停止当前任务请求" };
      default:
        return { status: "blocked", message: "当前执行器不支持该动作" };
    }
  }
}

