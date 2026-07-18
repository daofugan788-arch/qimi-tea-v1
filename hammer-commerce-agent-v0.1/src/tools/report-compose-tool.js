export const reportComposeTool = {
  name: "report.compose",
  description: "把全部步骤结果汇总为用户可读的执行报告",
  riskLevel: "LOW",
  async execute({ goal }, context) {
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
      notice: "当前是 Sprint 01 Agent 核心测试版，尚未接入实时商品数据；报告不会虚构货源或市场价格。",
      generatedAt: new Date().toISOString(),
    };
  },
};
