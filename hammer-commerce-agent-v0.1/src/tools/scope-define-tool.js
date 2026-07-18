export const scopeDefineTool = {
  name: "scope.define",
  description: "把目标转换为可执行的选品筛选条件",
  riskLevel: "LOW",
  async execute(_input, context) {
    const goal = context.outputs["goal.analyze"];
    return {
      platform: goal.platform,
      category: goal.category,
      filters: [
        `目标利润率不低于 ${goal.targetMargin}%`,
        "优先体积小、重量轻、运费可控",
        "避开高退货率、强售后和侵权商品",
        "优先支持一件代发或小批量测试",
      ],
      dataStatus: "Sprint 01 暂未接入实时商品数据",
    };
  },
};
