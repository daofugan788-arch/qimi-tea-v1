import { BaseAgent } from "../base-agent.js";

export class ProductSearchAgent extends BaseAgent {
  static agentType = "commerce-product-search";

  async onTask(task) {
    const missionInput = task.mission?.input || {};
    const result = await this.useTool("commerce.product.search", {
      goal: missionInput.searchGoal || task.mission?.goal,
      ...missionInput,
      ...(missionInput.constraints || {}),
    });
    await this.emit("commerce.products.searched", {
      scannedCount: result.scannedCount,
      sourceCount: result.sourceCount,
      runId: result.runId,
    });
    return result;
  }
}
