import { TOOL_RISK, TOOL_TYPE } from "../../tools/tool-types.js";

const round = (value) => Math.round(Number(value || 0) * 100) / 100;

function publicValue(value) {
  const text = String(value || "").trim();
  return text && !/未公开|未知|暂无|not available/i.test(text) ? text : "未公开";
}

export class OpportunityDataTool {
  constructor() {
    this.name = "commerce.opportunity.collect";
    this.type = TOOL_TYPE.DATABASE;
    this.riskLevel = TOOL_RISK.LOW;
    this.description = "把 Browser Plugin 的真实网页结果整理成统一商品机会数据";
  }

  async execute(input = {}) {
    const browserResult = input.browserResult || {};
    const minimumProfit = Number(browserResult.plan?.constraints?.minProfit ?? input.minimumProfit ?? 20);
    const timestamp = browserResult.capturedAt || new Date().toISOString();
    const shippingCost = Number(input.shippingCost) || 0;
    const platformRate = Math.max(0, Number(input.platformRate) || 0);
    const otherCost = Number(input.otherCost) || 0;
    const opportunities = (browserResult.items || []).map((item, index) => {
      const cost = round(item.cost ?? item.sourcePrice ?? item.price);
      const marketPrice = round(item.market_price ?? item.marketPrice ?? item.marketReference ?? item.price);
      const shipping = round(item.shippingCost ?? shippingCost);
      const platformCost = round(item.platformCost ?? marketPrice * platformRate);
      const other = round(item.otherCost ?? otherCost);
      const totalCost = round(cost + shipping + platformCost + other);
      const profit = round(marketPrice - totalCost);
      const profitRate = marketPrice > 0 ? round((profit / marketPrice) * 100) : 0;
      return {
        id: `OPP-${Date.now().toString(36).toUpperCase()}-${index + 1}`,
        name: String(item.name || item.title || "未命名商品").trim(),
        source: String(item.source || "未知公开来源").trim(),
        currency: String(item.currency || "").trim(),
        source_url: String(item.sourceUrl || item.url || "").trim(),
        screenshot: String(item.screenshotUrl || item.screenshot || "").trim(),
        page_screenshot: String(item.pageScreenshotUrl || "").trim(),
        image: String(item.imageUrl || item.image || "").trim(),
        cost,
        shipping,
        platform_cost: platformCost,
        other_cost: other,
        total_cost: totalCost,
        market_price: marketPrice,
        profit,
        profit_rate: profitRate,
        sales_signal: publicValue(item.salesText),
        review_signal: publicValue(item.reviewText),
        rating_signal: publicValue(item.ratingText),
        product_type: String(item.productType || "").trim(),
        browser_verified: Boolean(item.browserVerified),
        browser_verified_at: item.browserVerifiedAt || null,
        browser_error: item.browserError || null,
        description: String(item.description || "").trim(),
        competition: "中",
        after_sales_risk: /electronic|battery|glass|cosmetic|beauty|size/i.test(`${item.productType || ""} ${(item.tags || []).join(" ")}`) ? "中" : "低",
        risk: "待 Decision Service 判断",
        decision: "PENDING",
        reason: "等待 Decision Service",
        history_results: [],
        experience: { attempts: 0, totalOrders: 0, totalProfit: 0, successCount: 0, failureCount: 0, lastResultAt: null },
        timestamp: item.capturedAt || timestamp,
        daily_date: input.dailyDate || String(item.capturedAt || timestamp).slice(0, 10),
        evidence_run_id: browserResult.runId || null,
        minimum_profit: Number.isFinite(minimumProfit) ? minimumProfit : 20,
      };
    });
    return {
      runId: browserResult.runId || null,
      evidenceFile: browserResult.browserEvidenceFile || browserResult.evidenceFile || null,
      browserVerifiedCount: Number(browserResult.browserVerifiedCount) || 0,
      scannedCount: (browserResult.items || []).length,
      opportunities,
      collectedAt: timestamp,
    };
  }
}
