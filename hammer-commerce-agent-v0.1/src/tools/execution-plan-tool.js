export const executionPlanTool = {
  name: "execution.plan",
  description: "生成下一步可以执行的电商工作方案",
  riskLevel: "LOW",
  async execute(_input, context) {
    const goal = context.outputs["goal.analyze"];
    return {
      headline: `围绕${goal.platform === "待确认" ? "目标平台" : goal.platform}建立首轮选品池`,
      actions: [
        "收集 3—5 个候选商品的采购价、运费和预期售价",
        `按不低于 ${goal.targetMargin}% 的目标利润率进行第一轮淘汰`,
        "检查同类竞争、售后风险、运输难度和侵权风险",
        "保留 1—2 个低成本商品进行真实发布测试",
      ],
      requiredInputs: ["商品名称", "采购价", "预计售价", "运费", "平台费用"],
    };
  },
};
