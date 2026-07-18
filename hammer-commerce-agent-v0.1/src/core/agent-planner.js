import { STEP_STATUS } from "./task-status.js";

const GOAL_STEP_TEMPLATES = Object.freeze([
  { tool: "goal.analyze", title: "理解你的卖货目标" },
  { tool: "scope.define", title: "确定选品与利润条件" },
  { tool: "execution.plan", title: "生成可执行工作方案" },
  { tool: "report.compose", title: "汇总任务执行报告" },
]);

const PRODUCT_STEP_TEMPLATES = Object.freeze([
  { tool: "goal.analyze", title: "理解商品分析目标" },
  { tool: "product.normalize", title: "核对商品成本数据" },
  { tool: "profit.calculate", title: "计算利润与最低成交价" },
  { tool: "product.score", title: "评估需求、竞争与风险" },
  { tool: "report.compose", title: "生成商业分析报告" },
]);

export class AgentPlanner {
  createPlan(task) {
    if (!task?.goal) throw new Error("任务缺少用户目标");
    const templates = task.type === "PRODUCT_ANALYSIS" ? PRODUCT_STEP_TEMPLATES : GOAL_STEP_TEMPLATES;
    return templates.map((template, index) => ({
      id: `${task.id}-S${index + 1}`,
      index,
      title: template.title,
      tool: template.tool,
      status: STEP_STATUS.WAITING,
      output: null,
      error: null,
    }));
  }
}
