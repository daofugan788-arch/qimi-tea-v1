import { TOOL_OUTCOME } from "../core/chain-status.js";
import { BrowserSearchPlanner } from "../core/browser-search-planner.js";
import { judgeProducts, PRODUCT_DECISION } from "../core/product-judgment-engine.js";

const success = (data) => ({ outcome: TOOL_OUTCOME.SUCCESS, data });
const blocked = (actionType, reason, data = null) => ({ outcome: TOOL_OUTCOME.BLOCKED, actionType, reason, data });
const round = (value) => Math.round(Number(value || 0) * 100) / 100;

export class BrowserSearchPlanTool {
  constructor(planner = new BrowserSearchPlanner()) {
    this.name = "browser.search.plan";
    this.description = "把找货目标拆成公开页面搜索、筛选、利润计算和证据保存任务";
    this.riskLevel = "LOW";
    this.planner = planner;
  }

  async execute(_input, runtime) {
    return success(this.planner.createPlan(runtime.chain.goal));
  }
}

export class BrowserPublicSearchTool {
  constructor(client) {
    this.name = "browser.public.search";
    this.description = "通过 Browser Agent 服务打开公开页面并读取公开商品信息";
    this.riskLevel = "LOW";
    this.client = client;
  }

  async execute(_input, runtime) {
    if (runtime.chain.context.signals?.skipBrowser) {
      return success({ status: "SKIPPED", items: [], reason: "主人使用一句话商品资料作为安全回退" });
    }
    if (!this.client?.enabled) {
      return blocked(
        "BROWSER_SERVICE_REQUIRED",
        "Browser Tool 代码已就绪，但公开网页浏览服务尚未连接。系统不会用假数据冒充搜索结果。",
        { required: "VITE_BROWSER_AGENT_URL" },
      );
    }
    const plan = runtime.chain.context.outputs["browser.search.plan"];
    try {
      const result = await this.client.search({ goal: runtime.chain.goal, plan });
      if (!result.items.length) {
        return blocked("NO_PUBLIC_RESULTS", "已完成公开页面搜索，但没有找到符合价格与利润条件的候选商品。", { plan });
      }
      return success({ status: "SUCCESS", ...result });
    } catch (error) {
      return blocked("BROWSER_SEARCH_FAILED", error?.message || "公开页面搜索失败", { plan });
    }
  }
}

export class BrowserEvidenceSaveTool {
  constructor({ evidenceStore, productStore }) {
    this.name = "browser.evidence.save";
    this.description = "保存来源、时间、商品信息和价格截图，并写入候选商品库";
    this.riskLevel = "LOW";
    this.evidenceStore = evidenceStore;
    this.productStore = productStore;
  }

  async execute(_input, runtime) {
    const search = runtime.chain.context.outputs["browser.public.search"];
    const plan = runtime.chain.context.outputs["browser.search.plan"];
    if (search?.status === "SKIPPED") return success({ skipped: true, session: null, products: [] });
    const session = this.evidenceStore.save({
      goal: runtime.chain.goal,
      plan,
      items: search?.items || [],
      sourceRunId: search?.runId,
    });
    const products = (search?.items || []).map((item) => this.productStore.saveDiscovery({
      ...item,
      evidenceSessionId: session.id,
    }));
    return success({ skipped: false, session, products });
  }
}

export class BrowserProductJudgeTool {
  constructor(productStore) {
    this.name = "browser.product.judge";
    this.description = "根据利润门槛和真实公开证据自动决定测试、观察或放弃";
    this.riskLevel = "LOW";
    this.productStore = productStore;
  }

  async execute(_input, runtime) {
    const evidence = runtime.chain.context.outputs["browser.evidence.save"];
    const plan = runtime.chain.context.outputs["browser.search.plan"];
    if (evidence?.skipped) return success({ skipped: true, products: [], selectedProduct: null });
    const judged = judgeProducts(evidence?.products || [], plan);
    const products = judged.map(({ product, judgment }) => (
      this.productStore.updateJudgment(product.id, judgment) || { ...product, judgment }
    ));
    const selectedProduct = products.find((product) => product.agentDecision === PRODUCT_DECISION.TEST) || null;
    return success({
      skipped: false,
      products,
      selectedProduct,
      counts: {
        test: products.filter((product) => product.agentDecision === PRODUCT_DECISION.TEST).length,
        watch: products.filter((product) => product.agentDecision === PRODUCT_DECISION.WATCH).length,
        reject: products.filter((product) => product.agentDecision === PRODUCT_DECISION.REJECT).length,
      },
      operationRemoved: "用户不再逐个判断候选商品",
    });
  }
}

export const browserReportComposeTool = {
  name: "browser.report.compose",
  description: "根据公开页面证据生成今日选品报告",
  riskLevel: "LOW",
  async execute(_input, runtime) {
    const plan = runtime.chain.context.outputs["browser.search.plan"];
    const evidence = runtime.chain.context.outputs["browser.evidence.save"];
    const judgment = runtime.chain.context.outputs["browser.product.judge"];
    if (evidence?.skipped || judgment?.skipped) return success({ kind: "BROWSER_SELECTION_REPORT", skipped: true, items: [] });
    const items = (judgment?.products || []).map((product) => ({
      id: product.id,
      name: product.name,
      source: product.source,
      sourceUrl: product.sourceUrl,
      sourcePrice: product.cost,
      marketReference: product.price,
      estimatedProfit: product.profit,
      salesText: product.salesText,
      reviewText: product.reviewText,
      ratingText: product.ratingText,
      imageUrl: product.imageUrl,
      screenshotUrl: product.screenshotUrl,
      recommendation: product.decisionLabel || "等待判断",
      decision: product.agentDecision || "WATCH",
      decisionConfidence: product.decisionConfidence || 0,
      reasons: product.decisionReasons || [],
      risks: product.decisionRisks || [],
      nextAction: product.decisionNextAction || "",
      selected: judgment?.selectedProduct?.id === product.id,
      reason: (product.decisionReasons || []).join("；") || product.reason || "公开证据等待进一步判断。",
    }));
    return success({
      kind: "BROWSER_SELECTION_REPORT",
      skipped: false,
      title: "今日选品报告",
      query: plan?.query,
      discovered: items.length,
      worthyCount: judgment?.counts?.test || 0,
      decisionCounts: judgment?.counts,
      selectedProductId: judgment?.selectedProduct?.id || null,
      evidenceSessionId: evidence?.session?.id,
      capturedAt: evidence?.session?.capturedAt,
      items,
      operationReduction: { before: 6, after: 1, reduced: 5 },
      notice: "价格及页面提供的销量、评价字段来自抓取时可公开访问的页面；未公开字段会明确标记，预计利润不等于实际成交利润。",
    });
  },
};

export function createBrowserTools({ browserClient, evidenceStore, productStore }) {
  return [
    new BrowserSearchPlanTool(),
    new BrowserPublicSearchTool(browserClient),
    new BrowserEvidenceSaveTool({ evidenceStore, productStore }),
    new BrowserProductJudgeTool(productStore),
    browserReportComposeTool,
  ];
}
