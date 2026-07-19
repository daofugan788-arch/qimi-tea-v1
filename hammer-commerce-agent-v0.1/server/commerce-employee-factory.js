import path from "node:path";
import { createHammerOS, JsonFileMemoryAdapter } from "../hammer-os/index.js";
import { createCommercePlugin } from "../hammer-os/plugins/commerce/commerce-plugin.js";
import { OpenAICompatibleContentClient } from "../hammer-os/plugins/commerce/openai-compatible-content-client.js";
import { ShopifyPublicCatalogProvider } from "../hammer-os/plugins/commerce/shopify-public-catalog-provider.js";

const DEFAULT_SOURCES = [
  { name: "Kikkerland 公开商品目录", baseUrl: "https://www.kikkerland.com", currency: "USD" },
  { name: "ColourPop 公开商品目录", baseUrl: "https://colourpop.com", currency: "USD" },
  { name: "BlendJet 公开商品目录", baseUrl: "https://blendjet.com", currency: "USD" },
];

function sourceConfigs(env) {
  if (!env.COMMERCE_SHOPIFY_SOURCES_JSON) return DEFAULT_SOURCES;
  const parsed = JSON.parse(env.COMMERCE_SHOPIFY_SOURCES_JSON);
  if (!Array.isArray(parsed) || !parsed.length) throw new Error("COMMERCE_SHOPIFY_SOURCES_JSON 必须是非空数组");
  return parsed;
}

export function defaultMissionInput(env = process.env, { useFixedConstraints = false } = {}) {
  const input = {
    shippingCost: Number(env.COMMERCE_SHIPPING_COST || 5),
    platformRate: Number(env.COMMERCE_PLATFORM_RATE || 0.05),
    otherCost: Number(env.COMMERCE_OTHER_COST || 0),
    desiredCount: 3,
    channel: env.COMMERCE_SALES_CHANNEL || "个人二手/社交销售平台",
  };
  if (useFixedConstraints) {
    input.constraints = {
      maxSourcePrice: Number(env.COMMERCE_MAX_SOURCE_PRICE || 100),
      minProfit: Number(env.COMMERCE_MIN_PROFIT || 20),
      limit: Number(env.COMMERCE_SCAN_LIMIT || 60),
    };
  }
  return input;
}

export function createCommerceEmployee({ env = process.env, dailyEnabled = false, memoryFile = null } = {}) {
  const dataDirectory = path.resolve(env.HAMMER_DATA_DIR || "data");
  const resolvedMemoryFile = path.resolve(memoryFile || path.join(dataDirectory, "hammer-memory.json"));
  const searchProviders = sourceConfigs(env).map((source) => new ShopifyPublicCatalogProvider(source));
  const contentClient = new OpenAICompatibleContentClient({
    baseUrl: env.BASE_URL || "",
    apiKey: env.API_KEY || "",
    model: env.MODEL || "",
  });
  const fixed = defaultMissionInput(env, { useFixedConstraints: true });
  const commercePlugin = createCommercePlugin({
    searchProviders,
    contentClient: contentClient.enabled ? contentClient : null,
    dailyMission: {
      enabled: dailyEnabled,
      timeZone: env.COMMERCE_DAILY_TIMEZONE || "Asia/Shanghai",
      hour: Number(env.COMMERCE_DAILY_HOUR || 8),
      minute: Number(env.COMMERCE_DAILY_MINUTE || 0),
      goal: env.COMMERCE_DAILY_GOAL || "找到今天最值得测试的3个商品",
      searchGoal: env.COMMERCE_SEARCH_GOAL || "寻找价格100以内、预计利润20以上的热门小商品",
      constraints: fixed.constraints,
      shippingCost: fixed.shippingCost,
      platformRate: fixed.platformRate,
      otherCost: fixed.otherCost,
      keepAlive: true,
    },
  });
  const hammer = createHammerOS({
    memoryAdapter: new JsonFileMemoryAdapter(resolvedMemoryFile),
    plugins: [commercePlugin],
  });
  return { hammer, memoryFile: resolvedMemoryFile };
}

export async function dispatchCommerceMission(hammer, goal, input = {}, env = process.env) {
  const text = String(goal || "").trim().slice(0, 300);
  if (!text) throw new Error("请输入一句赚钱目标");
  const providedInput = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const mission = await hammer.orchestrator.dispatch({
    type: "commerce.daily",
    goal: text,
    priority: 100,
    input: { ...defaultMissionInput(env), ...providedInput },
    metadata: { autonomous: true, source: providedInput.source || "owner-command" },
  });
  if (mission.status !== "SUCCESS") throw new Error(mission.error || "Commerce Mission 执行失败");
  return {
    mission,
    report: mission.tasks.find((task) => task.input?.action === "report")?.output || null,
  };
}
