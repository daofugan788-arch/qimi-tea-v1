import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { ShopifyPublicCatalogProvider } from "../hammer-os/plugins/commerce/shopify-public-catalog-provider.js";

const SOURCES = Object.freeze([
  { name: "Kikkerland 公开商品目录", baseUrl: "https://www.kikkerland.com", currency: "USD" },
  { name: "ColourPop 公开商品目录", baseUrl: "https://colourpop.com", currency: "USD" },
  { name: "BlendJet 公开商品目录", baseUrl: "https://blendjet.com", currency: "USD" },
]);

export const MISSION_STEPS = Object.freeze([
  { id: "mission", title: "创建 Mission" },
  { id: "search", title: "搜索公开商品" },
  { id: "profit", title: "计算成本与利润" },
  { id: "decision", title: "判断测试价值" },
  { id: "save", title: "保存本机结果" },
  { id: "report", title: "生成执行报告" },
]);

const round = (value) => Math.round(Number(value || 0) * 100) / 100;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function numberFrom(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function constraintsFrom(goal) {
  return {
    maxSourcePrice: numberFrom(goal, [
      /(?:成本|采购价|价格)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(?:元|块|美元|USD)?\s*(?:以内|以下)?/i,
      /(\d+(?:\.\d+)?)\s*(?:元|块|美元|USD)?\s*(?:以内|以下)/i,
    ]),
    minimumProfit: numberFrom(goal, [
      /利润[^\d]{0,8}(\d+(?:\.\d+)?)\s*(?:元|块|美元|USD)?\s*(?:以上|起)?/i,
      /至少赚[^\d]{0,4}(\d+(?:\.\d+)?)/,
    ]) ?? 5,
  };
}

async function publicCatalogFetch(url, options = {}) {
  if (!Capacitor.isNativePlatform()) return fetch(url, options);
  const response = await CapacitorHttp.get({
    url: String(url),
    headers: { Accept: "application/json" },
    connectTimeout: 15_000,
    readTimeout: 20_000,
  });
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    async json() {
      return typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    },
  };
}

function rankProduct(item, constraints) {
  const sourceCost = round(item.price);
  const marketPrice = round(item.marketReference);
  const platformCost = round(marketPrice * 0.05);
  const estimatedProfit = round(marketPrice - sourceCost - platformCost);
  const profitRate = marketPrice > 0 ? round((estimatedProfit / marketPrice) * 100) : 0;
  const profitPass = estimatedProfit >= constraints.minimumProfit;
  const pricePass = constraints.maxSourcePrice === null || sourceCost <= constraints.maxSourcePrice;
  let decision = "REJECT";
  if (pricePass && estimatedProfit > 0) decision = "WATCH";
  if (pricePass && profitPass && profitRate >= 15) decision = "TEST";
  const reason = decision === "TEST"
    ? `公开价差可覆盖约5%平台成本，预计利润 ${estimatedProfit} ${item.currency}`
    : decision === "WATCH"
      ? `存在 ${estimatedProfit} ${item.currency} 价差，但利润或利润率尚未达到测试门槛`
      : pricePass
        ? "当前公开售价没有形成足够的可验证利润空间"
        : `公开来源价高于任务上限 ${constraints.maxSourcePrice}`;
  return {
    id: item.id,
    name: item.name,
    source: item.source,
    sourceUrl: item.sourceUrl,
    imageUrl: item.imageUrl,
    currency: item.currency || "USD",
    sourceCost,
    marketPrice,
    platformCost,
    estimatedProfit,
    profitRate,
    decision,
    reason,
    capturedAt: new Date().toISOString(),
  };
}

function resultPriority(item) {
  return ({ TEST: 3, WATCH: 2, REJECT: 1 })[item.decision] || 0;
}

export async function executeMobileMission(goal, onProgress = () => {}) {
  const missionGoal = String(goal || "").trim().slice(0, 300);
  if (!missionGoal) throw new Error("请先输入一句任务");
  const missionId = `MISSION-${Date.now().toString(36).toUpperCase()}`;
  const startedAt = new Date().toISOString();
  const constraints = constraintsFrom(missionGoal);
  const progress = async (stepId, detail) => {
    onProgress({ stepId, detail, at: new Date().toISOString() });
    await wait(180);
  };

  await progress("mission", `已创建 ${missionId}`);
  await progress("search", "正在读取允许访问的公开商品目录");

  const providers = SOURCES.map((source) => new ShopifyPublicCatalogProvider({
    ...source,
    fetchImpl: publicCatalogFetch,
  }));
  const settled = await Promise.allSettled(providers.map((provider) => provider.search({
    constraints: { maxSourcePrice: constraints.maxSourcePrice },
  })));
  const sourceErrors = settled
    .map((result, index) => result.status === "rejected" ? `${SOURCES[index].name}：${result.reason?.message || "读取失败"}` : null)
    .filter(Boolean);
  const discovered = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!discovered.length) {
    throw new Error(sourceErrors.length ? `公开商品读取失败：${sourceErrors.join("；")}` : "没有读取到公开商品");
  }

  await progress("profit", `已读取 ${discovered.length} 个公开商品，正在计算利润`);
  const unique = [...new Map(discovered.map((item) => [item.sourceUrl, item])).values()];
  const ranked = unique
    .map((item) => rankProduct(item, constraints))
    .sort((a, b) => resultPriority(b) - resultPriority(a) || b.estimatedProfit - a.estimatedProfit)
    .slice(0, 20);

  await progress("decision", `已完成 ${ranked.length} 个候选的 TEST / WATCH / REJECT 判断`);
  const topProducts = ranked.slice(0, 3);
  const testCount = ranked.filter((item) => item.decision === "TEST").length;
  const report = {
    missionId,
    goal: missionGoal,
    status: "SUCCESS",
    startedAt,
    completedAt: new Date().toISOString(),
    scannedCount: discovered.length,
    analyzedCount: ranked.length,
    testCount,
    products: topProducts,
    summary: testCount > 0
      ? `本次发现 ${testCount} 个达到 TEST 门槛的候选，优先查看前 3 个。`
      : "本次没有候选达到 TEST 门槛，已保留最接近门槛的 3 个供观察。",
    notice: "结果来自执行时读取的公开商品目录。来源价、对比价和预计利润不等于真实采购价或最终成交利润，测试前必须再次核价。",
    sourceErrors,
  };

  await progress("save", "Mission 与商品结果已保存到当前手机");
  localStorage.setItem("hammer-os-android-last-report", JSON.stringify(report));
  await progress("report", "执行报告已生成");
  return report;
}

export function loadLastMobileReport() {
  try {
    return JSON.parse(localStorage.getItem("hammer-os-android-last-report") || "null");
  } catch {
    return null;
  }
}
