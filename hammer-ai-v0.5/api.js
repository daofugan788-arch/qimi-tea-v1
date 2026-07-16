import { AI_CONFIG, hasRemoteAIConfig } from "./config.js";

const PLATFORM_LABELS = Object.freeze({
  wechat: "微信朋友圈",
  xiaohongshu: "小红书",
  douyin: "抖音",
  taobao: "淘宝详情",
});

function clean(value, maxLength = 300) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanGeneratedContent(value, maxLength = 6000) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trimEnd())
    .join("\n")
    .trim()
    .slice(0, maxLength);
}

function splitHighlights(value) {
  return clean(value, 500)
    .split(/[、，,；;|。]+/)
    .map((item) => clean(item, 80))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeProduct(input = {}) {
  const highlights = splitHighlights(input.highlights);
  return {
    name: clean(input.name, 60) || "这款商品",
    price: clean(input.price, 30),
    highlights: highlights.length ? highlights : ["简单实用", "品质可靠"],
    audience: clean(input.audience, 100) || "有需要的朋友",
    platform: PLATFORM_LABELS[input.platform] ? input.platform : "wechat",
  };
}

function priceLine(product) {
  return product.price ? `到手价：${product.price}` : "价格可以私聊了解";
}

function buildWechat(product) {
  const points = product.highlights.map((item) => `✓ ${item}`).join("\n");
  return `最近发现一个很值得分享的好东西——${product.name}。\n\n${points}\n\n特别适合${product.audience}，日常使用省心，也不用花时间反复挑选。\n\n${priceLine(product)}\n\n想了解细节或需要下单，直接私信我，我把完整信息发给你。`;
}

function buildXiaohongshu(product) {
  const points = product.highlights.map((item, index) => `${index + 1}. ${item}`).join("\n");
  return `标题｜最近用到的${product.name}，真实感受分享\n\n最近在找适合${product.audience}的商品，试过之后觉得这款${product.name}挺值得说一说。\n\n使用感受：\n${points}\n\n它不是只看起来好看，而是日常真的用得上。${priceLine(product)}，综合体验和价格都比较合适。\n\n如果你也在挑同类产品，可以先收藏对比，有问题欢迎留言。\n\n#${product.name.replace(/\s+/g, "")} #好物分享 #真实体验`;
}

function buildDouyin(product) {
  const points = product.highlights.slice(0, 3).map((item, index) => `${8 + index * 5}-${13 + index * 5}秒：镜头展示“${item}”。`).join("\n");
  return `【短视频口播脚本｜约30秒】\n\n0-3秒：还在为挑不到合适的${product.name}发愁吗？先看完这条。\n\n3-8秒：近景展示商品，口播：“这是我最近在用的${product.name}，主要给${product.audience}准备。”\n\n${points}\n\n23-27秒：展示实际使用场景，口播：“重点不是说得多好，而是真的方便、用得上。”\n\n27-30秒：${priceLine(product)}。想了解具体怎么选，评论区留言或直接私信。`;
}

function buildTaobao(product) {
  const points = product.highlights.map((item, index) => `卖点 ${index + 1}｜${item}`).join("\n");
  return `【${product.name}】\n\n适用人群：${product.audience}\n${priceLine(product)}\n\n核心卖点\n${points}\n\n购买理由\n从日常实际需求出发，减少复杂选择。商品信息清楚、使用场景明确，适合想省心购买的用户。\n\n购买提示\n下单前请确认规格、数量和收货信息。如需了解更多细节，请先咨询客服。`;
}

export function generateLocalContent(input) {
  const product = normalizeProduct(input);
  const builders = {
    wechat: buildWechat,
    xiaohongshu: buildXiaohongshu,
    douyin: buildDouyin,
    taobao: buildTaobao,
  };
  return {
    content: builders[product.platform](product),
    source: "local",
    platformLabel: PLATFORM_LABELS[product.platform],
  };
}

function normalizeChatURL(value) {
  const url = String(value || "").trim().replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(url) ? url : `${url}/chat/completions`;
}

function buildPrompt(input) {
  const product = normalizeProduct(input);
  return `你是服务普通微信卖货商家的中文营销文案助手。请生成可直接复制发布的${PLATFORM_LABELS[product.platform]}内容。\n商品：${product.name}\n价格：${product.price || "未填写"}\n卖点：${product.highlights.join("、")}\n目标客户：${product.audience}\n要求：语言自然可信，不夸大功效，不虚构数据，不输出解释，只输出最终内容。`;
}

async function generateRemoteContent(input, config, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(config.timeoutMs) || 30000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(normalizeChatURL(config.apiUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: "你只输出可直接发布的中文卖货内容。" },
          { role: "user", content: buildPrompt(input) },
        ],
        temperature: Number(config.temperature) || 0.7,
        max_tokens: Number(config.maxTokens) || 1200,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`模型接口返回 ${response.status}`);
    const data = await response.json();
    const content = cleanGeneratedContent(data?.choices?.[0]?.message?.content, 6000);
    if (!content) throw new Error("模型没有返回有效内容");
    return {
      content,
      source: "remote",
      platformLabel: PLATFORM_LABELS[normalizeProduct(input).platform],
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function generateMarketingContent(input, { config = AI_CONFIG, signal } = {}) {
  if (!hasRemoteAIConfig(config)) return generateLocalContent(input);
  try {
    return await generateRemoteContent(input, config, signal);
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return {
      ...generateLocalContent(input),
      warning: `模型暂时不可用，已改用本地模板：${error?.message || "连接失败"}`,
    };
  }
}

export { PLATFORM_LABELS };
