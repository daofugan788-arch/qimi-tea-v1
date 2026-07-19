import { TOOL_RISK, TOOL_TYPE } from "../../tools/tool-types.js";

export class OpportunityReportTool {
  constructor() {
    this.name = "commerce.daily.report";
    this.type = TOOL_TYPE.PLUGIN;
    this.riskLevel = TOOL_RISK.LOW;
    this.description = "根据真实机会数据和 Decision 结果生成主人日报";
  }

  async execute(input = {}) {
    const evaluated = input.evaluated || [];
    const recommended = evaluated
      .filter((item) => item.decision === "TEST")
      .sort((a, b) => b.score - a.score || b.profit - a.profit)
      .slice(0, Number(input.reportLimit) || 3);
    const filtered = evaluated.filter((item) => item.decision !== "REJECT");
    const first = recommended[0] || null;
    const decisionPriority = { TEST: 3, WATCH: 2, REJECT: 1 };
    const productList = [...evaluated]
      .sort((a, b) => decisionPriority[b.decision] - decisionPriority[a.decision] || b.score - a.score || b.profit - a.profit)
      .slice(0, 12);
    const top3 = productList.filter((item) => item.decision !== "REJECT").slice(0, Number(input.reportLimit) || 3);
    const generatedAt = new Date().toISOString();
    const scheduled = ["daily-08:00", "evening-20:00", "github-actions"].includes(input.missionSource);
    const date = input.dailyDate || generatedAt.slice(0, 10);
    const todayStrategy = first
      ? `优先核对 ${first.name} 的库存、最终运费与供货稳定性；只做1件小规模测试，并在成交后回填订单数和实际利润。`
      : "今日没有达到 TEST 门槛的商品；保留证据，明日更换关键词继续搜索，不为低证据商品投入资金。";
    return {
      kind: "COMMERCE_EMPLOYEE_DAILY_REPORT",
      title: "今日商业机会报告",
      missionId: input.missionId || null,
      goal: input.goal || "寻找今日机会商品",
      date,
      generatedAt,
      scannedCount: Number(input.scannedCount) || 0,
      filteredCount: filtered.length,
      browserVerifiedCount: Number(input.browserVerifiedCount) || evaluated.filter((item) => item.browser_verified).length,
      recommendedCount: recommended.length,
      recommendations: recommended,
      opportunityCount: filtered.length,
      top3,
      productList,
      publishingMaterials: input.materials || [],
      firstRecommendation: first,
      summary: first
        ? `今日扫描 ${Number(input.scannedCount) || 0} 个商品，筛选 ${filtered.length} 个，推荐 ${recommended.length} 个。第一推荐：${first.name}，预计利润 ${first.profit}，风险${first.risk}。`
        : `今日扫描 ${Number(input.scannedCount) || 0} 个商品，暂未找到达到测试门槛且证据完整的机会。`,
      nextAction: first
        ? "复制第一推荐的商品资料，核对真实采购价、运费和库存后，进行1件小规模测试。"
        : "调整成本或利润条件后继续搜索；不要为未达门槛商品生成发布计划。",
      todayStrategy,
      evidenceRunId: input.evidenceRunId || null,
      evidenceFile: input.evidenceFile || null,
      operationReduction: scheduled
        ? { before: 10, after: 0, reduced: 10, reductionRate: 100 }
        : { before: 10, after: 1, reduced: 9, reductionRate: 90 },
      notice: "Agent 只读取白名单公开页面，不登录、不发布、不下单、不付款；利润为公开样本估算，测试前保留主人确认。",
    };
  }
}
