import { generateMarketingContent, PLATFORM_LABELS } from "./api.js";
import { PAYMENT_CONFIG } from "./config.js";

const DRAFT_KEY = "hammer-ai-v0.5-draft";
const LAST_RESULT_KEY = "hammer-ai-v0.5-last-result";
const USAGE_KEY = "hammer-ai-v0.6-usage";
const CHECKOUT_KEY = "hammer-ai-v0.7-checkout";
const PAYMENT_ORDERS_KEY = "hammer-ai-v0.7-payment-orders";

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

let activeController = null;

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

function showPricing() {
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

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    applyFormData(examples[button.dataset.example]);
    saveDraft();
    showScreen("form");
  });
});

document.querySelectorAll("[data-back-home]").forEach((button) => {
  button.addEventListener("click", () => showScreen("home"));
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
document.querySelector("#view-pricing-button").addEventListener("click", showPricing);
document.querySelector("#pricing-back-button").addEventListener("click", () => showScreen("result"));
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
