import { generateMarketingContent, PLATFORM_LABELS } from "./api.js";
import { PAYMENT_CONFIG } from "./config.js";

const DRAFT_KEY = "hammer-ai-v0.5-draft";
const LAST_RESULT_KEY = "hammer-ai-v0.5-last-result";
const USAGE_KEY = "hammer-ai-v0.6-usage";

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

let activeController = null;

function readUsage() {
  try {
    return {
      generations: 0,
      copies: 0,
      pricingViews: 0,
      accessRequests: 0,
      ...JSON.parse(localStorage.getItem(USAGE_KEY) || "{}"),
    };
  } catch {
    return { generations: 0, copies: 0, pricingViews: 0, accessRequests: 0 };
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
  interestStatus.textContent = "点击后把申请信息发给给你链接的人即可。";
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

document.querySelector("#request-access-button").addEventListener("click", () => requestAccess({ share: true }));
document.querySelector("#copy-request-button").addEventListener("click", () => requestAccess());

loadDraft();
showScreen("home");
