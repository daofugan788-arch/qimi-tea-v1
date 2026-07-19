import { TOOL_RISK, TOOL_TYPE } from "../../tools/tool-types.js";

function numberFrom(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function constraintsFrom(goal, input = {}) {
  return {
    maxSourcePrice: Number.isFinite(Number(input.maxSourcePrice))
      ? Number(input.maxSourcePrice)
      : numberFrom(goal, [/(?:成本|采购价|价格)[^\d]{0,8}(\d+(?:\.\d+)?)\s*元?\s*(?:以内|以下)?/, /(\d+(?:\.\d+)?)\s*元?\s*(?:以内|以下)/]),
    minProfit: Number.isFinite(Number(input.minimumProfit))
      ? Number(input.minimumProfit)
      : numberFrom(goal, [/利润[^\d]{0,8}(\d+(?:\.\d+)?)\s*元?\s*(?:以上|起)?/, /至少赚[^\d]{0,4}(\d+(?:\.\d+)?)/]) ?? 20,
    limit: Math.max(3, Math.min(100, Number(input.scanLimit) || 60)),
  };
}

export class ProductSearchTool {
  constructor(providers = []) {
    this.name = "commerce.product.search";
    this.type = TOOL_TYPE.SEARCH;
    this.riskLevel = TOOL_RISK.LOW;
    this.description = "从允许访问的公开商品目录收集名称、价格、图片和来源链接";
    this.providers = providers;
  }

  async execute(input = {}) {
    if (!this.providers.length) throw new Error("没有配置公开商品数据源，Search Agent 不会生成假商品");
    const goal = String(input.goal || "帮我找赚钱商品").trim();
    const constraints = constraintsFrom(goal, input);
    const batches = [];
    const errors = [];
    for (const provider of this.providers) {
      try {
        const items = await provider.search({
          goal,
          keywords: input.keywords || [],
          constraints,
        });
        batches.push(...items);
      } catch (error) {
        errors.push({ source: provider.name, error: error?.message || "公开商品源读取失败" });
      }
    }
    const unique = [...new Map(batches.filter((item) => item.sourceUrl).map((item) => [item.sourceUrl, item])).values()]
      .sort((a, b) => (b.marketReference - b.price) - (a.marketReference - a.price))
      .slice(0, constraints.limit);
    if (!unique.length) {
      throw new Error(`公开商品搜索没有可用结果${errors.length ? `：${errors.map((item) => `${item.source} ${item.error}`).join("；")}` : ""}`);
    }
    const capturedAt = new Date().toISOString();
    return {
      status: "SUCCESS",
      runId: `SRCH-${Date.now().toString(36).toUpperCase()}`,
      goal,
      plan: { constraints },
      items: unique.map((item) => ({ ...item, capturedAt: item.capturedAt || capturedAt })),
      scannedCount: batches.length,
      sourceCount: this.providers.length - errors.length,
      sourceErrors: errors,
      capturedAt,
    };
  }
}

export { constraintsFrom };
