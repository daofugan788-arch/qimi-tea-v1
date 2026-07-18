import { generateMarketingContent, reviseMarketingContent, PLATFORM_LABELS } from "./api.js";
import { PAYMENT_CONFIG } from "./config.js";

const DRAFT_KEY = "hammer-ai-v0.5-draft";
const LAST_RESULT_KEY = "hammer-ai-v0.5-last-result";
const USAGE_KEY = "hammer-ai-v0.6-usage";
const CHECKOUT_KEY = "hammer-ai-v0.7-checkout";
const PAYMENT_ORDERS_KEY = "hammer-ai-v0.7-payment-orders";
const AGENT_MEMORY_KEY = "hammer-ai-v0.8-agent-memory";

const screens = [...document.querySelectorAll("[data-screen]")];
const form = document.querySelector("#product-form");
const nameInput = document.querySelector("#product-name");
const priceInput = document.querySelector("#product-price");
const highlightsInput = document.querySelector("#product-highlights");
const audienceInput = document.querySelector("#target-audience");
const formError = document.querySelector("#form-error");
const resultContent = document.querySelector("#result-content");
const resultPlatform = document.querySelector("#result-platform");
const resultProduct = document.querySelector("#result-product");
const resultNotice = document.querySelector("#result-notice");
const copyButton = document.querySelector("#copy-button");
const toast = document.querySelector("#toast");
const interestStatus = document.querySelector("#interest-status");
const paymentQr = document.querySelector("#payment-qr");
const paymentPlaceholder = document.querySelector("#payment-placeholder");
const confirmPaymentButton = document.querySelector("#confirm-payment-button");
const paymentNote = document.querySelector("#payment-note");
const checkoutOrderId = document.querySelector("#checkout-order-id");
const paymentStatusOrderId = document.querySelector("#payment-status-order-id");
const agentMessages = document.querySelector("#agent-messages");
const agentQuickReplies = document.querySelector("#agent-quick-replies");
const agentComposer = document.querySelector("#agent-composer");
const agentInput = document.querySelector("#agent-input");
const agentMemoryStatus = document.querySelector("#agent-memory-status");
const agentResult = document.querySelector("#agent-result");
const agentResultContent = document.querySelector("#agent-result-content");
const agentResultNotice = document.querySelector("#agent-result-notice");
const agentCopyButton = document.querySelector("#agent-copy-button");

let activeController = null;
let agentStage = "idle";
let agentTask = null;
let pricingReturnScreen = "result";

function readUsage() {
  try {
    return {
      generations: 0,
      copies: 0,
      pricingViews: 0,
      accessRequests: 0,
      checkoutStarts: 0,
      paymentSubmissions: 0,
      ...JSON.parse(localStorage.getItem(USAGE_KEY) || "{}"),
    };
  } catch {
    return { generations: 0, copies: 0, pricingViews: 0, accessRequests: 0, checkoutStarts: 0, paymentSubmissions: 0 };
  }
}

function writeUsage(changes = {}) {
  const next = { ...readUsage(), ...changes, updatedAt: Date.now() };
  localStorage.setItem(USAGE_KEY, JSON.stringify(next));
  return next;
}

function hasFreeGeneration() {
  return !PAYMENT_CONFIG.enabled || readUsage().generations < PAYMENT_CONFIG.freeGenerations;
}

function showPricing(returnScreen = "result") {
  pricingReturnScreen = returnScreen;
  const usage = readUsage();
  writeUsage({ pricingViews: usage.pricingViews + 1, lastPricingViewAt: Date.now() });
  interestStatus.textContent = "进入收款页后确认方案和订单信息。";
  showScreen("pricing");
}

function showScreen(name) {
  screens.forEach((screen) => {
    const active = screen.dataset.screen === name;
    screen.classList.toggle("active", active);
    screen.setAttribute("aria-hidden", String(!active));
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "form") setTimeout(() => nameInput.focus(), 80);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function getPlatform() {
  return form.querySelector('input[name="platform"]:checked')?.value || "wechat";
}

function getFormData() {
  return {
    name: nameInput.value.trim(),
    price: priceInput.value.trim(),
    highlights: highlightsInput.value.trim(),
    audience: audienceInput.value.trim(),
    platform: getPlatform(),
  };
}

function applyFormData(data = {}) {
  nameInput.value = data.name || "";
  priceInput.value = data.price || "";
  highlightsInput.value = data.highlights || "";
  audienceInput.value = data.audience || "";
  const platform = form.querySelector(`input[name="platform"][value="${data.platform || "wechat"}"]`);
  if (platform) platform.checked = true;
}

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(getFormData()));
}

function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (draft) applyFormData(draft);
  } catch {
    localStorage.removeItem(DRAFT_KEY);
  }
}

function validate(data) {
  if (!data.name) return "先填写商品名称。";
  if (!data.highlights) return "至少填写一个商品卖点。";
  if (data.name.length > 60 || data.highlights.length > 300) return "填写内容过长，请精简后再生成。";
  return "";
}

function showResult(data, result) {
  resultPlatform.textContent = result.platformLabel || PLATFORM_LABELS[data.platform];
  resultProduct.textContent = data.price ? `${data.name} · ${data.price}` : data.name;
  resultContent.textContent = result.content;
  resultNotice.textContent = result.warning || (result.source === "remote" ? "内容由 AI 生成，请发布前检查。" : "当前使用本地模板生成，商品资料没有上传。 ");
  localStorage.setItem(LAST_RESULT_KEY, JSON.stringify({ data, result, createdAt: Date.now() }));
  const usage = readUsage();
  writeUsage({ generations: usage.generations + 1, lastGeneratedAt: Date.now() });
  showScreen("result");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

async function copyResult() {
  const text = resultContent.textContent;
  await copyText(text);
  const usage = readUsage();
  writeUsage({ copies: usage.copies + 1, lastCopiedAt: Date.now() });
  copyButton.textContent = "已复制，可以去发布了";
  showToast("文案已复制");
  setTimeout(() => { copyButton.textContent = "一键复制全部内容"; }, 1800);
}

function readAgentMemory() {
  try {
    return {
      products: [],
      tasks: [],
      preferences: {},
      ...JSON.parse(localStorage.getItem(AGENT_MEMORY_KEY) || "{}"),
    };
  } catch {
    return { products: [], tasks: [], preferences: {} };
  }
}

function writeAgentMemory(memory) {
  const next = { ...memory, updatedAt: Date.now() };
  localStorage.setItem(AGENT_MEMORY_KEY, JSON.stringify(next));
  updateAgentMemoryStatus(next);
  return next;
}

function updateAgentMemoryStatus(memory = readAgentMemory()) {
  const products = Array.isArray(memory.products) ? memory.products : [];
  if (!products.length) {
    agentMemoryStatus.textContent = "第一次见面，我会记住你的商品和偏好";
    return;
  }
  const latest = products[0];
  agentMemoryStatus.textContent = `已记住 ${products.length} 个商品 · 最近：${latest.name}`;
}

function appendAgentMessage(role, text) {
  const message = document.createElement("div");
  message.className = `agent-message ${role}`;
  const avatar = document.createElement("span");
  avatar.textContent = role === "assistant" ? "H" : "我";
  const bubble = document.createElement("p");
  bubble.textContent = text;
  message.append(avatar, bubble);
  agentMessages.appendChild(message);
  setTimeout(() => message.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 20);
  return message;
}

function setAgentQuickReplies(items = []) {
  agentQuickReplies.replaceChildren();
  items.forEach((item) => {
    const option = typeof item === "string" ? { label: item, value: item } : item;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    button.addEventListener("click", () => processAgentAnswer(option.value, option.label));
    agentQuickReplies.appendChild(button);
  });
}

function setAgentInput({ placeholder, disabled = false } = {}) {
  if (placeholder) agentInput.placeholder = placeholder;
  agentInput.disabled = disabled;
  document.querySelector("#agent-send-button").disabled = disabled;
  if (!disabled) setTimeout(() => agentInput.focus(), 80);
}

function resetAgentConversation() {
  agentMessages.replaceChildren();
  setAgentQuickReplies([]);
  agentResult.hidden = true;
  agentResultContent.textContent = "";
  agentResultNotice.textContent = "";
  setAgentInput({ placeholder: "输入商品名称…", disabled: false });
}

function createAgentTask(data = {}) {
  return {
    id: `TASK-${Date.now().toString(36).slice(-7).toUpperCase()}`,
    name: data.name || "",
    price: data.price || "",
    highlights: data.highlights || "",
    audience: data.audience || "",
    platform: data.platform || "",
    result: "",
    countedGeneration: false,
    createdAt: Date.now(),
  };
}

function beginNewAgentTask() {
  agentTask = createAgentTask();
  agentStage = "name";
  agentResult.hidden = true;
  appendAgentMessage("assistant", "先告诉我商品名称，剩下的我一步一步问你。");
  setAgentQuickReplies([
    { label: "凤凰单丛茶", value: "凤凰单丛茶" },
    { label: "新疆大枣", value: "新疆大枣" },
  ]);
  setAgentInput({ placeholder: "例如：凤凰单丛茶" });
}

function askAgentPlatform() {
  agentStage = "platform";
  const preferred = readAgentMemory().preferences?.platform;
  appendAgentMessage("assistant", preferred
    ? `上次你常用${PLATFORM_LABELS[preferred]}。这次准备发到哪里？`
    : "资料够了。准备发到哪里？");
  setAgentQuickReplies([
    { label: "微信朋友圈", value: "wechat" },
    { label: "小红书", value: "xiaohongshu" },
    { label: "抖音口播", value: "douyin" },
    { label: "淘宝详情", value: "taobao" },
  ]);
  setAgentInput({ placeholder: "选择上方平台即可" });
}

function startAgent({ example } = {}) {
  showScreen("agent");
  resetAgentConversation();
  updateAgentMemoryStatus();
  appendAgentMessage("assistant", "你好，我是 Hammer 卖货 Agent。你只管说商品，我负责问清楚、生成和修改。");

  if (example) {
    agentTask = createAgentTask(example);
    agentStage = "confirm-example";
    appendAgentMessage("assistant", `我已读到案例：${example.name}，${example.price}，卖点是${example.highlights}。要直接生成${PLATFORM_LABELS[example.platform]}文案吗？`);
    setAgentQuickReplies([
      { label: "直接生成", value: "__generate__" },
      { label: "换个平台", value: "__change_platform__" },
    ]);
    setAgentInput({ placeholder: "也可以告诉我需要修改什么" });
    return;
  }

  const memory = readAgentMemory();
  const latest = memory.products?.[0];
  if (latest) {
    agentStage = "resume";
    appendAgentMessage("assistant", `我还记得你上次的商品“${latest.name}”。继续用它，还是卖一个新商品？`);
    setAgentQuickReplies([
      { label: `继续卖${latest.name}`, value: "__resume__" },
      { label: "换个新商品", value: "__new__" },
    ]);
    setAgentInput({ placeholder: "选择上方操作，或输入新商品名称" });
    return;
  }
  beginNewAgentTask();
}

function rememberAgentTask(task) {
  const memory = readAgentMemory();
  const product = {
    name: task.name,
    price: task.price,
    highlights: task.highlights,
    audience: task.audience,
    platform: task.platform,
    lastUsedAt: Date.now(),
  };
  const products = [product, ...(memory.products || []).filter((item) => item.name.toLowerCase() !== task.name.toLowerCase())].slice(0, 12);
  const taskRecord = {
    id: task.id,
    product: product.name,
    platform: task.platform,
    result: task.result,
    createdAt: task.createdAt,
    updatedAt: Date.now(),
  };
  const tasks = [taskRecord, ...(memory.tasks || []).filter((item) => item.id !== task.id)].slice(0, 20);
  writeAgentMemory({
    ...memory,
    products,
    tasks,
    preferences: { ...memory.preferences, platform: task.platform },
  });
}

function renderAgentResult(result) {
  document.querySelector("#agent-result-platform").textContent = result.platformLabel || PLATFORM_LABELS[agentTask.platform];
  document.querySelector("#agent-result-product").textContent = agentTask.price ? `${agentTask.name} · ${agentTask.price}` : agentTask.name;
  agentResultContent.textContent = result.content;
  agentResultNotice.textContent = result.warning || (result.source === "remote"
    ? "内容由 AI 生成，请发布前检查。"
    : "当前使用本地生成能力；接入正式模型后支持任意要求改写。");
  agentResult.hidden = false;
}

async function runAgentGeneration({ countGeneration = true } = {}) {
  if (countGeneration && !hasFreeGeneration()) {
    appendAgentMessage("assistant", "免费体验已经完成。开通商家内测后，我就能继续为你处理新商品。");
    showPricing("agent");
    return;
  }

  agentStage = "generating";
  setAgentQuickReplies([]);
  setAgentInput({ placeholder: "Agent 正在生成…", disabled: true });
  appendAgentMessage("assistant", `收到，我正在生成${PLATFORM_LABELS[agentTask.platform]}内容。`);
  try {
    const result = await generateMarketingContent(agentTask);
    agentTask.result = result.content;
    if (countGeneration && !agentTask.countedGeneration) {
      const usage = readUsage();
      writeUsage({ generations: usage.generations + 1, lastGeneratedAt: Date.now() });
      agentTask.countedGeneration = true;
    }
    rememberAgentTask(agentTask);
    renderAgentResult(result);
    appendAgentMessage("assistant", "已经生成好了。你可以直接复制，也可以继续告诉我怎么改。修改同一篇不会重复计算次数。");
    agentStage = "result";
    setAgentInput({ placeholder: "例如：再口语一点" });
  } catch (error) {
    appendAgentMessage("assistant", error?.message || "刚才生成失败了，请再试一次。");
    agentStage = "platform";
    askAgentPlatform();
  }
}

async function reviseAgentResult(instruction) {
  if (!agentTask?.result) return;
  agentStage = "generating";
  setAgentQuickReplies([]);
  setAgentInput({ placeholder: "Agent 正在修改…", disabled: true });
  appendAgentMessage("user", instruction);
  appendAgentMessage("assistant", "收到，我按这个要求重新整理。");
  try {
    const result = await reviseMarketingContent(agentTask.result, instruction, agentTask);
    agentTask.result = result.content;
    rememberAgentTask(agentTask);
    renderAgentResult(result);
    appendAgentMessage("assistant", result.warning || "已经改好了，再看看这版。");
  } catch (error) {
    appendAgentMessage("assistant", error?.message || "修改失败，请再试一次。");
  } finally {
    agentStage = "result";
    setAgentInput({ placeholder: "还可以继续说修改要求" });
  }
}

function resolvePlatform(value) {
  const text = String(value || "").toLowerCase();
  if (PLATFORM_LABELS[text]) return text;
  if (/小红书/.test(text)) return "xiaohongshu";
  if (/抖音|口播|短视频/.test(text)) return "douyin";
  if (/淘宝|详情/.test(text)) return "taobao";
  if (/微信|朋友圈/.test(text)) return "wechat";
  return "";
}

async function processAgentAnswer(value, displayText = value) {
  const answer = String(value || "").trim();
  if (!answer || agentStage === "generating") return;
  if (!answer.startsWith("__") && agentStage !== "result") appendAgentMessage("user", displayText);
  setAgentQuickReplies([]);

  if (agentStage === "resume") {
    if (answer === "__resume__") {
      const latest = readAgentMemory().products?.[0];
      agentTask = createAgentTask(latest || {});
      appendAgentMessage("user", displayText);
      appendAgentMessage("assistant", `好的，继续使用“${agentTask.name}”的资料。`);
      askAgentPlatform();
      return;
    }
    if (answer === "__new__") {
      appendAgentMessage("user", displayText);
      beginNewAgentTask();
      return;
    }
    agentTask = createAgentTask({ name: answer });
    agentStage = "price";
    appendAgentMessage("assistant", `${answer}卖多少钱？不想展示价格也可以跳过。`);
    setAgentQuickReplies([{ label: "暂不写价格", value: "__skip_price__" }]);
    setAgentInput({ placeholder: "例如：128元" });
    return;
  }

  if (agentStage === "confirm-example") {
    if (answer === "__generate__") {
      appendAgentMessage("user", displayText);
      await runAgentGeneration();
      return;
    }
    if (answer === "__change_platform__") {
      appendAgentMessage("user", displayText);
      askAgentPlatform();
      return;
    }
  }

  if (agentStage === "name") {
    agentTask.name = answer.slice(0, 60);
    agentStage = "price";
    appendAgentMessage("assistant", `${agentTask.name}卖多少钱？不想展示价格也可以跳过。`);
    setAgentQuickReplies([{ label: "暂不写价格", value: "__skip_price__" }]);
    setAgentInput({ placeholder: "例如：128元" });
    return;
  }

  if (agentStage === "price") {
    if (answer.startsWith("__")) appendAgentMessage("user", displayText);
    agentTask.price = answer === "__skip_price__" ? "" : answer.slice(0, 30);
    agentStage = "highlights";
    appendAgentMessage("assistant", "它最值得买的地方是什么？写 1—3 个卖点就行。");
    setAgentQuickReplies([{ label: "不知道怎么写", value: "品质可靠、使用方便" }]);
    setAgentInput({ placeholder: "例如：产地正宗、香气明显、耐冲泡" });
    return;
  }

  if (agentStage === "highlights") {
    agentTask.highlights = answer.slice(0, 300);
    agentStage = "audience";
    appendAgentMessage("assistant", "主要想卖给哪些客户？不知道也可以交给我判断。");
    setAgentQuickReplies([{ label: "不限定人群", value: "__skip_audience__" }]);
    setAgentInput({ placeholder: "例如：喜欢喝茶的人" });
    return;
  }

  if (agentStage === "audience") {
    if (answer.startsWith("__")) appendAgentMessage("user", displayText);
    agentTask.audience = answer === "__skip_audience__" ? "有需要的朋友" : answer.slice(0, 100);
    askAgentPlatform();
    return;
  }

  if (agentStage === "platform") {
    const platform = resolvePlatform(answer);
    if (!platform) {
      appendAgentMessage("assistant", "我还没认出这个平台，请从下面选择一个。");
      askAgentPlatform();
      return;
    }
    agentTask.platform = platform;
    await runAgentGeneration({ countGeneration: !agentTask.countedGeneration });
    return;
  }

  if (agentStage === "result") await reviseAgentResult(answer);
}

function readPaymentOrders() {
  try {
    const orders = JSON.parse(localStorage.getItem(PAYMENT_ORDERS_KEY) || "[]");
    return Array.isArray(orders) ? orders : [];
  } catch {
    return [];
  }
}

function savePaymentOrder(order) {
  const orders = readPaymentOrders();
  const index = orders.findIndex((item) => item.orderId === order.orderId);
  if (index >= 0) orders[index] = order;
  else orders.unshift(order);
  localStorage.setItem(PAYMENT_ORDERS_KEY, JSON.stringify(orders.slice(0, 20)));
  localStorage.setItem(CHECKOUT_KEY, JSON.stringify(order));
  return order;
}

function readCurrentCheckout() {
  try {
    return JSON.parse(localStorage.getItem(CHECKOUT_KEY) || "null");
  } catch {
    return null;
  }
}

function renderCheckout(order) {
  document.querySelector("#checkout-plan-name").textContent = order.planName;
  document.querySelector("#checkout-amount").textContent = `¥${order.amount}`;
  document.querySelector("#checkout-cycle").textContent = `/ ${order.billingCycle}`;
  document.querySelector("#payment-method").textContent = `收款方式：${PAYMENT_CONFIG.paymentMethodLabel}`;
  checkoutOrderId.textContent = order.orderId;

  const hasPaymentCode = Boolean(String(PAYMENT_CONFIG.paymentQrUrl || "").trim());
  paymentQr.hidden = !hasPaymentCode;
  paymentPlaceholder.hidden = hasPaymentCode;
  if (hasPaymentCode) {
    paymentQr.src = PAYMENT_CONFIG.paymentQrUrl;
    confirmPaymentButton.textContent = "我已完成付款";
    paymentNote.textContent = "付款时请备注订单编号，完成后点击上方按钮，等待管理员核对。";
  } else {
    paymentQr.removeAttribute("src");
    confirmPaymentButton.textContent = "模拟已付款（测试）";
    paymentNote.textContent = "当前是安全测试模式，仅验证购买流程，不会收款。";
  }
}

function createCheckout() {
  const order = savePaymentOrder({
    orderId: `HAM-${Date.now().toString(36).slice(-7).toUpperCase()}`,
    planName: PAYMENT_CONFIG.planName,
    amount: PAYMENT_CONFIG.price,
    billingCycle: PAYMENT_CONFIG.billingCycle,
    status: "pending_payment",
    testMode: !Boolean(String(PAYMENT_CONFIG.paymentQrUrl || "").trim()),
    createdAt: Date.now(),
  });
  const usage = readUsage();
  writeUsage({
    checkoutStarts: usage.checkoutStarts + 1,
    lastCheckoutAt: Date.now(),
    lastCheckoutOrderId: order.orderId,
  });
  renderCheckout(order);
  showScreen("checkout");
}

function renderPaymentStatus(order) {
  paymentStatusOrderId.textContent = order.orderId;
}

function submitPaymentForConfirmation() {
  const checkout = readCurrentCheckout();
  if (!checkout) {
    showToast("订单已失效，请重新进入收款页");
    showPricing();
    return;
  }
  const order = savePaymentOrder({
    ...checkout,
    status: "waiting_confirmation",
    submittedAt: Date.now(),
  });
  const usage = readUsage();
  writeUsage({
    paymentSubmissions: usage.paymentSubmissions + 1,
    lastPaymentSubmittedAt: Date.now(),
    lastPaymentOrderId: order.orderId,
  });
  renderPaymentStatus(order);
  showScreen("payment-status");
}

async function sharePaymentOrder() {
  const order = readCurrentCheckout();
  if (!order) {
    showToast("没有找到订单");
    return;
  }
  const modeText = order.testMode ? "测试订单（未真实付款）" : "已提交付款申请";
  const text = `Hammer AI ${order.planName}\n订单编号：${order.orderId}\n金额：¥${order.amount}/${order.billingCycle}\n状态：${modeText}，等待人工确认`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Hammer AI 付款申请", text });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  await copyText(text);
  showToast("订单信息已复制");
}

const examples = {
  tea: {
    name: "凤凰单丛茶",
    price: "128元",
    highlights: "广东产地、香气明显、耐冲泡",
    audience: "喜欢喝茶的人",
    platform: "wechat",
  },
  date: {
    name: "新疆大枣",
    price: "59元",
    highlights: "果肉厚、甜度高、家庭分享装",
    audience: "家庭消费者",
    platform: "xiaohongshu",
  },
};

document.querySelectorAll("[data-start]").forEach((button) => {
  button.addEventListener("click", () => showScreen("form"));
});

document.querySelectorAll("[data-start-agent]").forEach((button) => {
  button.addEventListener("click", () => startAgent());
});

document.querySelectorAll("[data-agent-example]").forEach((button) => {
  button.addEventListener("click", () => {
    startAgent({ example: examples[button.dataset.agentExample] });
  });
});

document.querySelectorAll("[data-back-home]").forEach((button) => {
  button.addEventListener("click", () => showScreen("home"));
});

document.querySelector("#agent-back-button").addEventListener("click", () => showScreen("home"));
agentComposer.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = agentInput.value.trim();
  if (!value) return;
  agentInput.value = "";
  processAgentAnswer(value);
});
agentCopyButton.addEventListener("click", async () => {
  if (!agentTask?.result) return;
  await copyText(agentTask.result);
  const usage = readUsage();
  writeUsage({ copies: usage.copies + 1, lastCopiedAt: Date.now() });
  agentCopyButton.textContent = "已复制，可以去发布了";
  showToast("文案已复制");
  setTimeout(() => { agentCopyButton.textContent = "一键复制发布"; }, 1800);
});
document.querySelectorAll("[data-agent-revise]").forEach((button) => {
  button.addEventListener("click", () => reviseAgentResult(button.dataset.agentRevise));
});
document.querySelector("#agent-change-platform").addEventListener("click", () => {
  if (!agentTask) return;
  appendAgentMessage("user", "换个平台");
  askAgentPlatform();
});
document.querySelector("#agent-new-task").addEventListener("click", () => {
  resetAgentConversation();
  appendAgentMessage("assistant", "好，我们开始一个新的卖货任务。");
  beginNewAgentTask();
});

form.addEventListener("input", saveDraft);
form.addEventListener("change", saveDraft);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = getFormData();
  const error = validate(data);
  formError.textContent = error;
  if (error) return;

  if (!hasFreeGeneration()) {
    showPricing();
    return;
  }

  saveDraft();
  activeController?.abort();
  activeController = new AbortController();
  showScreen("generating");
  try {
    const result = await generateMarketingContent(data, { signal: activeController.signal });
    showResult(data, result);
  } catch (errorValue) {
    if (errorValue?.name === "AbortError") return;
    formError.textContent = errorValue?.message || "生成失败，请稍后再试。";
    showScreen("form");
  } finally {
    activeController = null;
  }
});

document.querySelector("#cancel-generation").addEventListener("click", () => {
  activeController?.abort();
  showScreen("form");
});

document.querySelector("#edit-button").addEventListener("click", () => showScreen("form"));
document.querySelector("#edit-button-secondary").addEventListener("click", () => showScreen("form"));
document.querySelector("#new-button").addEventListener("click", () => {
  localStorage.removeItem(DRAFT_KEY);
  applyFormData({ platform: "wechat" });
  formError.textContent = "";
  showScreen("form");
});
copyButton.addEventListener("click", copyResult);
document.querySelector("#view-pricing-button").addEventListener("click", () => showPricing("result"));
document.querySelector("#pricing-back-button").addEventListener("click", () => showScreen(pricingReturnScreen));
document.querySelector("#pricing-home-button").addEventListener("click", () => showScreen("home"));
document.querySelector("#checkout-back-button").addEventListener("click", () => showScreen("pricing"));
document.querySelector("#payment-home-button").addEventListener("click", () => showScreen("home"));
document.querySelector("#copy-order-button").addEventListener("click", async () => {
  const order = readCurrentCheckout();
  if (!order) return;
  await copyText(order.orderId);
  showToast("订单编号已复制");
});
confirmPaymentButton.addEventListener("click", submitPaymentForConfirmation);
document.querySelector("#share-payment-button").addEventListener("click", sharePaymentOrder);

function createAccessRequest() {
  const requestId = `HAM-${Date.now().toString(36).slice(-6).toUpperCase()}`;
  return {
    requestId,
    text: `我想开通 Hammer AI ${PAYMENT_CONFIG.planName}（¥${PAYMENT_CONFIG.price}/${PAYMENT_CONFIG.billingCycle}），请联系我。开通编号：${requestId}`,
  };
}

async function requestAccess({ share = false } = {}) {
  const request = createAccessRequest();
  const usage = readUsage();
  writeUsage({
    accessRequests: usage.accessRequests + 1,
    lastAccessRequestAt: Date.now(),
    lastAccessRequestId: request.requestId,
  });

  if (share && navigator.share) {
    interestStatus.textContent = "正在打开手机分享面板……";
    try {
      await navigator.share({ title: "Hammer AI 商家内测", text: request.text });
      interestStatus.textContent = `申请已发出，编号 ${request.requestId}`;
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        interestStatus.textContent = "已取消分享，你也可以复制申请信息。";
        return;
      }
    }
  }

  await copyText(request.text);
  interestStatus.textContent = `申请信息已复制，编号 ${request.requestId}`;
  showToast("开通申请已复制");
}

document.querySelector("#request-access-button").addEventListener("click", createCheckout);
document.querySelector("#copy-request-button").addEventListener("click", () => requestAccess());

loadDraft();
showScreen("home");
