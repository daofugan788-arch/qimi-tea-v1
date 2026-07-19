import { BaseAgent } from "../base-agent.js";

export class CommerceAgent extends BaseAgent {
  static agentType = "commerce";

  async onTask(task) {
    await this.emit("commerce.task.received", { input: task.input });
    const result = await this.useTool("commerce.legacy.bridge", task.input || {});
    await this.remember(`${this.missionId}:${task.id}`, result);
    await this.emit("commerce.task.completed", { result });
    return result;
  }
}
