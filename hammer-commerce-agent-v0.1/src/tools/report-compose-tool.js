export const reportComposeTool = {
  name: "report.compose",
  description: "把全部步骤结果汇总为用户可读的执行报告",
  riskLevel: "LOW",
  async execute({ goal }, context) {
    if (context.task.type === "PRODUCT_ANALYSIS") {
      const product = context.outputs["product.normalize"];
      const profit = context.outputs["profit.calculate"];
      const score = context.outputs["product.score"];
      const nextActions = [];
      if (profit.salePrice < profit.recommendedPrice) {
        nextActions.push(`当前售价偏低，建议先测试 ¥${profit.recommendedPrice}，为售后和议价保留空间`);
      } else {
        nextActions.push(`当前售价 ¥${profit.salePrice} 已达到 30% 目标利润线，可先保持价格测试`);
      }
      nextActions.push(score.total >= 65
        ? "先发布 1—3 件或使用一件代发测试，不要提前大量囤货"
        : "暂不囤货，先对比 3 个同类商品的销量、价格与评价痛点");
      nextActions.push("向供应商确认次品、退换货、发货时效和运费变化规则");
      nextActions.push("记录曝光、咨询、议价和成交数据，3 天后重新评分");
      return {
        kind: "PRODUCT_ANALYSIS",
        title: "商业分析报告",
        goal,
        product: { name: product.name, note: product.note },
        recommendation: score.recommendation,
        cost: {
          purchase: profit.purchaseCost,
          shipping: profit.shipping,
          platformFee: profit.platformFee,
          total: profit.totalCost,
        },
        pricing: {
          current: profit.salePrice,
          recommended: profit.recommendedPrice,
          minimum: profit.minimumDealPrice,
        },
        profit: {
          gross: profit.grossProfit,
          net: profit.netProfit,
          rate: profit.profitRate,
        },
        score: {
          total: score.total,
          dimensions: score.dimensions,
          weights: score.weights,
        },
        risks: score.risks,
        nextActions,
        notice: score.dataBasis,
        generatedAt: new Date().toISOString(),
      };
    }
    const analysis = context.outputs["goal.analyze"];
    const scope = context.outputs["scope.define"];
    const plan = context.outputs["execution.plan"];
    return {
      title: "首轮电商任务执行报告",
      goal,
      summary: `已建立${analysis.category}选品任务，目标利润率为 ${analysis.targetMargin}% 以上。`,
      metrics: [
        { label: "目标平台", value: analysis.platform },
        { label: "目标类目", value: analysis.category },
        { label: "利润率门槛", value: `≥ ${analysis.targetMargin}%` },
      ],
      filters: scope.filters,
      actions: plan.actions,
      requiredInputs: plan.requiredInputs,
      notice: "当前是 V0.2 测试版，尚未接入实时商品数据；报告不会虚构货源或市场价格。",
      generatedAt: new Date().toISOString(),
    };
  },
};
