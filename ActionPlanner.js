// 将解析后的本地意图规划为有顺序的统一 Action 列表。
const SERVER_DIR = "/storage/emulated/0/Download/muxi-ai-v1/server";
const LOCAL_URL = "http://127.0.0.1:8787";

function createId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function action(type, params = {}, requiresConfirmation = false) {
  return {
    id: createId("action"),
    type,
    params,
    requiresConfirmation: Boolean(requiresConfirmation),
    status: "pending",
  };
}

const TEMPLATES = [
  { id: "start", title: "启动暮曦", description: "生成 Termux 启动步骤和本地地址", command: "启动暮曦" },
  { id: "check", title: "检查服务", description: "使用本地 curl 检查 8787 端口", command: "检查暮曦服务" },
  { id: "restart", title: "重启暮曦", description: "生成停止与重新启动步骤", command: "重启暮曦" },
  { id: "deploy", title: "部署新版", description: "只生成人工备份、解压和验证清单", command: "部署新版" },
];

export class ActionPlanner {
  getTemplates() {
    return TEMPLATES.map((item) => ({ ...item }));
  }

  plan(parsedIntent) {
    const raw = parsedIntent.normalizedText;
    switch (parsedIntent.intent) {
      case "navigate_settings":
        return [action("navigate", { route: "settings" }), action("show_message", { text: "已打开设置页面。" })];
      case "navigate_chat":
        return [action("navigate", { route: "chat" }), action("show_message", { text: "已打开聊天页面。" })];
      case "open_muxi":
        return [action("navigate", { route: "home" }), action("show_message", { text: "暮曦已经在当前网页中运行。" })];
      case "copy_start_command":
        return [action("copy_text", { text: "npm start", contentType: "safe_command" })];
      case "generate_termux_start":
        return [
          action("create_termux_command", { command: `cd ${SERVER_DIR} && npm start`, executor: "external_termux" }, true),
          action("show_message", { text: "命令只会生成在步骤卡片中，需要你确认后复制到 Termux 手动运行。" }),
        ];
      case "view_automation_history":
        return [action("navigate", { route: "automation", section: "history" }), action("show_message", { text: "已显示本机自动化历史。" })];
      case "stop_current_task":
        return [action("cancel_task", { scope: "current" })];
      case "clear_automation_history":
        return [action("clear_automation_history", { scope: "automation_only" }, true)];
      case "unzip_latest_muxi":
        return [
          action("show_message", { text: "需要外部执行器：PWA 不能直接操作 Android 文件管理器，也不会假装已经解压。" }),
          action("create_termux_command", { command: "ls /storage/emulated/0/Download", executor: "external_termux" }, true),
          action("show_message", { text: "安全步骤：1. 在文件管理器找到最新暮曦 ZIP；2. 手动解压；3. 检查解压目录中的 server/package.json；4. 再启动本地服务。V2.0 不生成 unzip、覆盖或删除命令。" }),
        ];
      case "start_muxi":
        return [
          action("open_app_request", { packageName: "com.termux", appName: "Termux", executor: "future_android" }, true),
          action("create_termux_command", { command: `cd ${SERVER_DIR}`, executor: "external_termux" }, true),
          action("create_termux_command", { command: "npm start", executor: "external_termux" }, true),
          action("open_url", { url: LOCAL_URL }, true),
        ];
      case "check_muxi_service":
        return [
          action("open_app_request", { packageName: "com.termux", appName: "Termux", executor: "future_android" }, true),
          action("create_termux_command", { command: `curl ${LOCAL_URL}`, executor: "external_termux" }, true),
          action("show_message", { text: "如果 curl 返回页面内容或 HTTP 响应，说明本地服务大概率正在运行。因命令白名单限制，本版本不会生成 ps、grep 或任意管道命令。" }),
        ];
      case "restart_muxi":
        return [
          action("open_app_request", { packageName: "com.termux", appName: "Termux", executor: "future_android" }, true),
          action("create_termux_command", { command: "pkill node", executor: "external_termux" }, true),
          action("create_termux_command", { command: `cd ${SERVER_DIR}`, executor: "external_termux" }, true),
          action("create_termux_command", { command: "npm start", executor: "external_termux" }, true),
          action("open_url", { url: LOCAL_URL }, true),
        ];
      case "deploy_new_version":
        return [
          action("show_message", { text: "部署新版只生成人工清单：先备份旧目录，再手动解压新 ZIP，不自动删除、覆盖或移动任何文件。" }),
          action("create_termux_command", { command: "ls /storage/emulated/0/Download", executor: "external_termux" }, true),
          action("show_message", { text: "解压后请人工检查 server/package.json，确认目录正确后再继续。" }),
          action("create_termux_command", { command: `cd ${SERVER_DIR} && npm install`, executor: "external_termux" }, true),
          action("create_termux_command", { command: "npm start", executor: "external_termux" }, true),
          action("open_url", { url: LOCAL_URL }, true),
        ];
      case "unsupported_delete_file":
        return [action("delete_file", { request: raw }, true)];
      case "unsupported_install_app":
        return [action("install_app", { request: raw }, true)];
      case "unsupported_send_message":
        return [action("send_message", { request: raw }, true)];
      case "unsupported_payment":
        return [action("payment", { request: raw }, true)];
      case "unsupported_system_change":
        return [action("modify_system_settings", { request: raw }, true)];
      case "unsupported_shell":
        return [action("execute_shell", { command: raw }, true)];
      default:
        return [action("show_message", { text: "暂时无法识别这条指令。可以尝试“打开设置”“启动暮曦”“检查暮曦服务”或点击下方模板。" })];
    }
  }
}

export const AUTOMATION_PATHS = { serverDir: SERVER_DIR, localURL: LOCAL_URL };

