import { BaseAgent } from "../base-agent.js";

export class ContentAgent extends BaseAgent {
  static agentType = "commerce-content";

  async onTask(task) {
    const evaluation = Object.values(task.dependencyOutputs || {}).find((value) => value !== null);
    if (!evaluation) throw new Error("Content Agent 没有收到选品结果");
    const materials = await this.useTool("commerce.content.generate", {
      evaluated: evaluation.evaluated || [],
      desiredCount: task.mission?.input?.contentCount || 3,
      channel: task.mission?.input?.channel || "个人二手/社交销售平台",
    });
    await this.emit("commerce.content.generated", { count: materials.items.length });
    return { ...evaluation, materials: materials.items };
  }
}
