import { Store, extractMemories, relevantMemories } from "./storage.js";
import { VoiceController } from "./voice.js";
import { AIClient } from "./ai-client.js";
import { AutomationEngine } from "./automation/AutomationEngine.js";
import { ActionExecutor } from "./automation/ActionExecutor.js";
import { automationRepository } from "./automation/AutomationRepository.js";
import { FileOrganizerAgent } from "./agents/FileOrganizerAgent.js";
import { LocalProductivityAgent } from "./agents/LocalProductivityAgent.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = {
  page: "home",
  memoryFilter: "all",
  sending: false,
  deferredInstallPrompt: null,
  voiceSource: "home",
  requestController: null,
  automationTask: null,
  automationExecuting: false,
};
const ai = new AIClient(() => Store.getSettings());
const automationExecutor = new ActionExecutor({
  navigate: (route, params) => {
    navigate(route);
    if (params?.section === "history") setTimeout(() => $("#automation-history-section")?.scrollIntoView?.({ behavior: "smooth" }), 100);
  },
  showMessage: showToast,
  openURL: (url) => window.open(url, "_blank", "noopener"),
  copyText: copyTextToClipboard,
  repository: automationRepository,
});
const automation = new AutomationEngine({ executor: automationExecutor, repository: automationRepository });
const fileOrganizerAgent = new FileOrganizerAgent({
  intentRouter: automation.intentRouter,
  planner: automation.agentPlanner,
  taskQueue: automation.taskQueue,
  executor: automation.agentExecutor,
  toolRegistry: automation.agentExecutor.toolRegistry,
});
const localProductivityAgent = new LocalProductivityAgent({
  intentRouter: automation.intentRouter,
  planner: automation.agentPlanner,
  taskQueue: automation.taskQueue,
  executor: automation.agentExecutor,
  toolRegistry: automation.agentExecutor.toolRegistry,
});
let toastTimer;

const elements = {
  pages: $$("[data-page]"),
  navButtons: $$("[data-nav]"),
  messageList: $("#message-list"),
  messageInput: $("#message-input"),
  chatForm: $("#chat-form"),
  typing: $("#typing-indicator"),
  chatVoice: $("#chat-voice-button"),
  homeVoice: $("#home-voice-button"),
  voiceHint: $("#voice-hint"),
  memoryList: $("#memory-list"),
  memoryEmpty: $("#memory-empty"),
  memoryDialog: $("#memory-dialog"),
  memoryForm: $("#memory-form"),
  automationForm: $("#automation-command-form"),
  automationInput: $("#automation-command-input"),
  automationTemplates: $("#automation-template-list"),
  automationResult: $("#automation-result"),
  automationIntent: $("#automation-intent-summary"),
  automationRiskBadge: $("#automation-risk-badge"),
  automationRiskNote: $("#automation-risk-note"),
  automationActionList: $("#automation-action-list"),
  automationRun: $("#automation-run-button"),
  automationCancel: $("#automation-cancel-button"),
  automationHistory: $("#automation-history-list"),
  automationHistoryEmpty: $("#automation-history-empty"),
  automationConfirmDialog: $("#automation-confirm-dialog"),
  automationConfirmText: $("#automation-confirm-text"),
  toast: $("#toast"),
  networkStatus: $("#network-status"),
  installButton: $("#install-button"),
};

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2500);
}

function escapeHTML(value) {
  const node = document.createElement("div");
  node.textContent = value;
  return node.innerHTML;
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("复制失败，请长按命令手动复制");
}

function navigate(page) {
  if (!["home", "chat", "memory", "automation", "settings"].includes(page)) page = "home";
  state.page = page;
  elements.pages.forEach((section) => section.classList.toggle("active", section.dataset.page === page));
  $$(".bottom-nav [data-nav]").forEach((button) => button.classList.toggle("active", button.dataset.nav === page));
  history.replaceState(null, "", `#${page}`);
  if (page === "chat") {
    renderMessages();
    setTimeout(() => elements.messageInput.focus({ preventScroll: true }), 80);
  }
  if (page === "memory") renderMemories();
  if (page === "automation") renderAutomationHistory();
  if (page === "settings") loadSettingsForm();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateHome() {
  const settings = Store.getSettings();
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  $("#greeting").textContent = greeting;
  $("#user-greeting").textContent = settings.userName ? `${settings.userName}，我在这里。` : "我在这里。";
  $("#date-label").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date()).toUpperCase();
  $("#brand-name").textContent = settings.assistantName || "暮曦";
  $("#chat-count").textContent = `${Store.getMessages().length} 条消息`;
  $("#memory-count").textContent = `${Store.getMemories().length} 条记忆`;
  document.title = `${settings.assistantName || "暮曦"} AI`;
}

function renderMessages() {
  const messages = Store.getMessages();
  if (!messages.length) {
    const assistant = Store.getSettings().assistantName || "暮曦";
    elements.messageList.innerHTML = `<article class="message assistant"><div class="bubble">晚上好，我是${escapeHTML(assistant)}。你可以打字，也可以点麦克风直接和我说话。</div><time>现在</time></article>`;
  } else {
    elements.messageList.innerHTML = messages.map((message) => {
      const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(message.createdAt));
      const isError = message.status === "error";
      const retryButton = isError ? `<button class="retry-button" type="button" data-retry-message="${message.id}">重新发送</button>` : "";
      return `<article class="message ${message.role}${isError ? " error" : ""}"><div class="bubble">${escapeHTML(message.content)}${retryButton}</div><time>${time}</time></article>`;
    }).join("");
  }
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
  updateHome();
}

async function sendMessage(rawText, { skipUser = false, errorId = null } = {}) {
  const text = String(rawText || "").trim();
  if (!text || state.sending) return;

  state.sending = true;
  state.requestController = new AbortController();
  if (errorId) Store.deleteMessage(errorId);
  if (!skipUser) Store.addMessage("user", text);
  elements.messageInput.value = "";
  resizeComposer();

  const settings = Store.getSettings();
  let savedCount = 0;
  if (!skipUser && settings.autoMemory) {
    for (const candidate of extractMemories(text)) {
      if (Store.addMemory(candidate.content, candidate.type, "conversation")) savedCount += 1;
    }
  }

  renderMessages();
  elements.typing.classList.remove("hidden");
  try {
    const reply = await ai.reply({
      messages: Store.getMessages(),
      memories: relevantMemories(text),
      signal: state.requestController.signal,
    });
    Store.addMessage("assistant", reply);
    renderMessages();
    if (settings.autoSpeak || state.voiceSource === "voice") voice.speak(reply);
    if (savedCount) showToast("已写入长期记忆");
  } catch (error) {
    if (error?.name === "AbortError") return;
    const message = error?.message || "发送失败，请稍后再试";
    Store.addMessage("assistant", `发送失败：${message}`, {
      status: "error",
      retryText: text,
    });
    renderMessages();
    showToast(message);
  } finally {
    elements.typing.classList.add("hidden");
    state.sending = false;
    state.requestController = null;
    state.voiceSource = "home";
  }
}

function resizeComposer() {
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 104)}px`;
}

const memoryLabels = {
  identity: { name: "关于我", icon: "我" },
  preference: { name: "偏好", icon: "♡" },
  note: { name: "其他", icon: "✦" },
};

function renderMemories() {
  const memories = Store.getMemories().filter((item) => state.memoryFilter === "all" || item.type === state.memoryFilter);
  elements.memoryList.innerHTML = memories.map((item) => {
    const label = memoryLabels[item.type] || memoryLabels.note;
    const date = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(item.createdAt));
    return `<article class="memory-item"><span>${label.icon}</span><div><h3>${label.name}</h3><p>${escapeHTML(item.content)}</p><small>${date} · ${item.source === "conversation" ? "对话记忆" : "手动添加"}</small></div><button type="button" data-delete-memory="${item.id}">×</button></article>`;
  }).join("");
  elements.memoryEmpty.classList.toggle("hidden", memories.length > 0);
  updateHome();
}

const automationActionLabels = {
  open_url: "打开网页",
  navigate: "页面导航",
  show_message: "显示提示",
  wait: "等待",
  copy_text: "复制文本",
  create_termux_command: "生成 Termux 命令",
  open_app_request: "外部应用请求",
  clear_automation_history: "清空自动化历史",
  cancel_task: "停止当前任务",
  delete_file: "删除文件",
  install_app: "安装应用",
  send_message: "发送消息",
  payment: "付款",
  modify_system_settings: "修改系统设置",
  execute_shell: "执行任意 Shell",
};

const automationStatusLabels = {
  pending: "待执行",
  waiting_confirmation: "等待确认",
  running: "执行中",
  completed: "已完成",
  external_required: "需要外部执行器",
  blocked: "已阻止",
  failed: "失败",
  cancelled: "已取消",
};

function automationParamSummary(item) {
  switch (item.type) {
    case "navigate": return `页面：${item.params.route}`;
    case "show_message": return item.params.text;
    case "wait": return `${item.params.milliseconds} 毫秒`;
    case "copy_text": return `复制：${item.params.text}`;
    case "open_url": return item.params.url;
    case "create_termux_command": return item.params.command;
    case "open_app_request": return `${item.params.appName}（${item.params.packageName}）\nPWA 只生成请求，不会直接打开 Android 应用。`;
    case "clear_automation_history": return "仅删除暮曦本机自动化日志";
    case "cancel_task": return "停止当前正在运行的自动化任务";
    default: return item.params.request || item.params.command || "当前版本未开放";
  }
}

function renderAutomationTemplates() {
  elements.automationTemplates.innerHTML = automation.getTemplates().map((template) => `
    <button class="automation-template-card" type="button" data-automation-template="${escapeHTML(template.command)}">
      <b>${escapeHTML(template.title)}</b><small>${escapeHTML(template.description)}</small>
    </button>`).join("");
}

function renderAutomationTask(task) {
  state.automationTask = task;
  elements.automationResult.classList.remove("hidden");
  elements.automationIntent.innerHTML = `<b>${escapeHTML(task.parsed.label)}</b><br>本地规则置信度：${Math.round(task.parsed.confidence * 100)}%<br>原始指令：${escapeHTML(task.input)}`;
  elements.automationRiskBadge.textContent = task.riskLevel;
  elements.automationRiskBadge.className = `risk-badge ${task.riskLevel.toLowerCase()}`;
  if (task.riskLevel === "HIGH") {
    elements.automationRiskNote.textContent = "HIGH 风险动作当前版本未开放，不会执行、复制或交给 Android。";
  } else if (task.riskLevel === "MEDIUM") {
    elements.automationRiskNote.textContent = "包含外部应用请求、Termux 命令或本地地址访问，必须在确认界面手动确认。";
  } else {
    elements.automationRiskNote.textContent = "仅包含页面导航、显示信息或复制固定文本等网页内动作。";
  }

  elements.automationActionList.innerHTML = task.actions.map((item, index) => {
    const errors = item.validationErrors?.length ? `<p class="automation-action-error">${escapeHTML(item.validationErrors.join("；"))}</p>` : "";
    const copyButton = item.type === "create_termux_command" && item.status === "external_required"
      ? `<button class="automation-copy-command" type="button" data-copy-automation-action="${item.id}">复制此命令</button>` : "";
    return `<article class="automation-action-card">
      <div class="automation-action-top"><div class="automation-action-title"><span class="automation-action-index">${index + 1}</span><b>${escapeHTML(automationActionLabels[item.type] || item.type)}</b></div><span class="automation-action-meta">${item.riskLevel} · ${item.requiresConfirmation ? "需要确认" : "无需确认"}<br>${escapeHTML(automationStatusLabels[item.status] || item.status)}</span></div>
      <p class="automation-action-params">${escapeHTML(automationParamSummary(item))}</p>${errors}${copyButton}
    </article>`;
  }).join("");

  const finished = ["completed", "cancelled", "failed"].includes(task.status);
  elements.automationRun.disabled = task.status === "blocked" || task.status === "running" || finished;
  elements.automationRun.textContent = task.status === "blocked" ? "当前版本未开放" : task.requiresConfirmation ? "确认执行" : "执行";
  elements.automationCancel.disabled = finished;
}

function renderAutomationHistory() {
  const history = automation.getHistory();
  elements.automationHistory.innerHTML = history.slice(0, 20).map((record) => {
    const date = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(record.updatedAt || record.createdAt));
    const error = record.error ? `<p class="history-error">${escapeHTML(record.error)}</p>` : "";
    const externalCount = record.steps?.filter((step) => step.status === "external_required").length || 0;
    return `<article class="automation-history-item"><div class="automation-history-head"><b>${escapeHTML(record.intentLabel || record.intent)}</b><span>${escapeHTML(automationStatusLabels[record.status] || record.status)} · ${date}</span></div><p>${escapeHTML(record.input)} · ${record.steps?.length || 0} 个步骤${externalCount ? ` · ${externalCount} 个需要外部执行` : ""}</p>${error}</article>`;
  }).join("");
  elements.automationHistoryEmpty.classList.toggle("hidden", history.length > 0);
}

function runAutomationCommand(command) {
  const value = String(command || "").trim();
  if (!value) { showToast("请先输入一条指令"); return; }
  const task = automation.createTask(value);
  elements.automationInput.value = value;
  renderAutomationTask(task);
  renderAutomationHistory();
  setTimeout(() => elements.automationResult.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}

async function executeAutomationTask(confirmed = false) {
  if (!state.automationTask || state.automationExecuting) return;
  state.automationExecuting = true;
  elements.automationRun.disabled = true;
  try {
    const result = await automation.execute(state.automationTask.id, { confirmed });
    renderAutomationTask(result);
    const externalCount = result.actions.filter((item) => item.status === "external_required").length;
    showToast(externalCount ? `已生成 ${externalCount} 个外部操作步骤` : "自动化任务已完成");
  } catch (error) {
    const current = automation.getTask(state.automationTask.id);
    if (current) renderAutomationTask(current);
    showToast(error?.message || "自动化任务失败");
  } finally {
    state.automationExecuting = false;
    renderAutomationHistory();
  }
}

function requestAutomationExecution() {
  const task = state.automationTask;
  if (!task || task.status === "blocked") return;
  if (!task.requiresConfirmation) { executeAutomationTask(false); return; }
  const confirmedSteps = task.actions.filter((item) => item.requiresConfirmation).map((item) => `• ${automationActionLabels[item.type] || item.type}：${automationParamSummary(item)}`).join("\n");
  elements.automationConfirmText.textContent = `风险等级：${task.riskLevel}\n\n${confirmedSteps}\n\nPWA 不会直接控制 Android 系统。Termux 命令仍需你逐条复制并手动运行。`;
  elements.automationConfirmDialog.showModal();
}

function cancelAutomationTask() {
  if (!state.automationTask) return;
  if (state.automationExecuting) {
    automation.cancelCurrentTask();
    showToast("正在停止当前任务");
    return;
  }
  automation.cancelPreview(state.automationTask.id);
  const current = automation.getTask(state.automationTask.id);
  if (current) renderAutomationTask(current);
  renderAutomationHistory();
  showToast("任务已取消");
}

function loadSettingsForm() {
  const settings = Store.getSettings();
  $("#user-name-input").value = settings.userName;
  $("#assistant-name-input").value = settings.assistantName;
  $("#auto-speak-toggle").checked = settings.autoSpeak;
  $("#auto-memory-toggle").checked = settings.autoMemory;
  $("#remote-ai-toggle").checked = settings.remoteAI;
  $("#ai-base-url-input").value = settings.aiBaseURL;
  $("#ai-api-key-input").value = settings.aiApiKey;
  $("#ai-model-input").value = settings.aiModel;
  $("#context-limit-input").value = settings.contextLimit;
  $("#api-endpoint-input").value = settings.apiEndpoint;
}

function saveSettingsForm() {
  const settings = Store.saveSettings({
    userName: $("#user-name-input").value.trim(),
    assistantName: $("#assistant-name-input").value.trim() || "暮曦",
    autoSpeak: $("#auto-speak-toggle").checked,
    autoMemory: $("#auto-memory-toggle").checked,
    remoteAI: $("#remote-ai-toggle").checked,
    aiBaseURL: $("#ai-base-url-input").value.trim(),
    aiApiKey: $("#ai-api-key-input").value.trim(),
    aiModel: $("#ai-model-input").value.trim(),
    contextLimit: Math.min(100, Math.max(2, Number($("#context-limit-input").value) || 20)),
    apiEndpoint: $("#api-endpoint-input").value.trim(),
  });
  updateHome();
  return settings;
}

function setListening(active) {
  document.body.classList.toggle("listening", active);
  elements.chatVoice.classList.toggle("listening", active);
  elements.voiceHint.textContent = active ? "正在听，请说话……" : "轻触开始语音";
}

const voice = new VoiceController({
  onStart: () => setListening(true),
  onEnd: () => setListening(false),
  onResult: (transcript, isFinal) => {
    elements.messageInput.value = transcript;
    resizeComposer();
    if (isFinal && transcript) {
      navigate("chat");
      state.voiceSource = "voice";
      sendMessage(transcript);
    }
  },
  onError: showToast,
});

elements.navButtons.forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
elements.chatForm.addEventListener("submit", (event) => { event.preventDefault(); state.voiceSource = "text"; sendMessage(elements.messageInput.value); });
elements.messageInput.addEventListener("input", resizeComposer);
elements.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    state.voiceSource = "text";
    sendMessage(elements.messageInput.value);
  }
});
elements.homeVoice.addEventListener("click", () => { state.voiceSource = "voice"; voice.toggle(); });
elements.chatVoice.addEventListener("click", () => { state.voiceSource = "voice"; voice.toggle(); });
elements.messageList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-retry-message]");
  if (!button) return;
  const failed = Store.getMessages().find((message) => message.id === button.dataset.retryMessage);
  if (failed?.retryText) sendMessage(failed.retryText, { skipUser: true, errorId: failed.id });
});
$("#new-chat-button").addEventListener("click", () => {
  if (confirm("开始新对话？长期记忆不会被删除。")) {
    Store.clearMessages();
    renderMessages();
  }
});

$("#add-memory-button").addEventListener("click", () => elements.memoryDialog.showModal());
$("#close-memory-dialog").addEventListener("click", () => elements.memoryDialog.close());
elements.memoryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const added = Store.addMemory($("#memory-content-input").value, $("#memory-type-input").value);
  if (added) {
    elements.memoryForm.reset();
    elements.memoryDialog.close();
    renderMemories();
    showToast("记忆已保存");
  }
});
$("#memory-filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.memoryFilter = button.dataset.filter;
  $$("#memory-filters button").forEach((item) => item.classList.toggle("active", item === button));
  renderMemories();
});
elements.memoryList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-memory]");
  if (button && confirm("删除这条记忆？")) {
    Store.deleteMemory(button.dataset.deleteMemory);
    renderMemories();
  }
});

elements.automationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runAutomationCommand(elements.automationInput.value);
});
elements.automationTemplates.addEventListener("click", (event) => {
  const button = event.target.closest("[data-automation-template]");
  if (button) runAutomationCommand(button.dataset.automationTemplate);
});
elements.automationRun.addEventListener("click", requestAutomationExecution);
elements.automationCancel.addEventListener("click", cancelAutomationTask);
elements.automationActionList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-automation-action]");
  if (!button || !state.automationTask) return;
  const item = state.automationTask.actions.find((action) => action.id === button.dataset.copyAutomationAction);
  if (!item || item.type !== "create_termux_command" || item.status !== "external_required") return;
  try {
    await copyTextToClipboard(item.params.command);
    showToast("命令已复制，请到 Termux 手动运行");
  } catch (error) {
    showToast(error?.message || "复制失败");
  }
});
$("#automation-clear-history").addEventListener("click", () => runAutomationCommand("清空任务记录"));
$("#close-automation-confirm").addEventListener("click", () => elements.automationConfirmDialog.close());
$("#cancel-automation-confirm").addEventListener("click", () => elements.automationConfirmDialog.close());
$("#confirm-automation-run").addEventListener("click", () => {
  elements.automationConfirmDialog.close();
  executeAutomationTask(true);
});

["#user-name-input", "#assistant-name-input", "#auto-speak-toggle", "#auto-memory-toggle"].forEach((selector) => {
  $(selector).addEventListener("change", () => { saveSettingsForm(); showToast("设置已保存"); });
});
$("#save-ai-settings-button").addEventListener("click", () => {
  saveSettingsForm();
  showToast("AI 设置已保存");
});
$("#test-api-button").addEventListener("click", async () => {
  saveSettingsForm();
  const status = $("#api-test-status");
  status.className = "api-test-status";
  status.textContent = "正在测试连接……";
  try {
    await ai.testConnection();
    status.className = "api-test-status success";
    status.textContent = "连接成功，可以开始真实 AI 聊天";
    showToast("模型连接成功");
  } catch (error) {
    status.className = "api-test-status error";
    status.textContent = error?.message || "连接失败";
    showToast(status.textContent);
  }
});
$("#clear-chat-button").addEventListener("click", () => {
  if (confirm("删除全部聊天记录？长期记忆不会被删除。")) {
    Store.clearMessages();
    renderMessages();
    showToast("聊天记录已删除");
  }
});
$("#export-button").addEventListener("click", () => {
  const backup = { ...Store.exportData(), version: 2, automation: automationRepository.exportData() };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `muxi-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast("备份已导出");
});
$("#import-button").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    Store.importData(backup);
    if (backup.automation) automationRepository.importData(backup.automation);
    updateHome(); renderMessages(); renderMemories(); renderAutomationHistory(); loadSettingsForm();
    showToast("备份已导入");
  } catch (error) {
    showToast(error.message || "导入失败");
  }
  event.target.value = "";
});
$("#clear-button").addEventListener("click", () => {
  if (confirm("确定清除全部对话、记忆和设置吗？此操作无法撤销。")) {
    Store.clearAll(); automationRepository.clearAll(); loadSettingsForm(); renderMessages(); renderMemories(); renderAutomationHistory(); updateHome();
    showToast("本机数据已清除");
  }
});

function updateNetwork() {
  const online = navigator.onLine;
  elements.networkStatus.classList.toggle("offline", !online);
  elements.networkStatus.querySelector("span").textContent = online ? "在线" : "离线";
}
window.addEventListener("online", updateNetwork);
window.addEventListener("offline", updateNetwork);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  elements.installButton.classList.remove("hidden");
});
elements.installButton.addEventListener("click", async () => {
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  elements.installButton.classList.add("hidden");
});
window.addEventListener("appinstalled", () => showToast("暮曦 AI 已安装到手机"));
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}

updateNetwork();
updateHome();
renderMessages();
renderMemories();
renderAutomationTemplates();
renderAutomationHistory();
loadSettingsForm();
navigate(location.hash.slice(1) || "home");
