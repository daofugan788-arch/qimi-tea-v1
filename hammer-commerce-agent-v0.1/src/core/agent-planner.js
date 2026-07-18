import { STEP_STATUS } from "./task-status.js";

const STEP_TEMPLATES = Object.freeze([
  { tool: "goal.analyze", title: "理解你的卖货目标" },
  { tool: "scope.define", title: "确定选品与利润条件" },
  { tool: "execution.plan", title: "生成可执行工作方案" },
  { tool: "report.compose", title: "汇总任务执行报告" },
]);

export class AgentPlanner {
  createPlan(task) {
    if (!task?.goal) throw new Error("任务缺少用户目标");
    return STEP_TEMPLATES.map((template, index) => ({
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
