export const reportComposeTool = {
  name: "report.compose",
  description: "把全部步骤结果汇总为用户可读的执行报告",
  riskLevel: "LOW",
  async execute({ goal }, context) {
    if (context.task.type === "PRODUCT_COMPARISON") {
      const comparison = context.outputs["product.compare"];
      const winner = comparison.winner;
      const runnerUp = comparison.rankings.find((product) => product.id !== winner?.id && product.profit > 0);
      const testPlan = winner
        ? [
          `优先测试「${winner.name}」，首批控制在 1—3 件或直接使用一件代发`,
          runnerUp ? `将「${runnerUp.name}」作为对照组，使用相同曝光周期测试` : "暂不增加对照商品，先验证第一名的真实需求",
          "连续记录 3 天曝光、咨询、议价、收藏和成交数据",
          "真实成交后更新成本与售后数据，再决定是否扩大投入",
        ]
        : [
          "当前候选商品均未达到测试门槛，先调整售价、成本或更换候选商品",
          "不要囤货，用平台真实同类价格重新校验输入数据",
        ];
      return {
        kind: "SELECTION_COMPARISON",
        title: "选品对比报告",
        goal,
        summary: winner
          ? `已对比 ${comparison.rankings.length} 个商品，建议优先测试「${winner.name}」。`
          : `已对比 ${comparison.rankings.length} 个商品，目前没有达到测试门槛的候选项。`,
        winner,
        rankings: comparison.rankings,
        viableCount: comparison.viableCount,
        rejectedCount: comparison.rejectedCount,
        testPlan,
        notice: "排名只使用商品库中已录入的成本与规则评分，不包含实时销量、搜索热度或平台竞争数据。",
        generatedAt: new Date().toISOString(),
      };
    }
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
      notice: "当前是 V0.3 测试版，尚未接入实时商品数据；报告不会虚构货源或市场价格。",
      generatedAt: new Date().toISOString(),
    };
  },
};
