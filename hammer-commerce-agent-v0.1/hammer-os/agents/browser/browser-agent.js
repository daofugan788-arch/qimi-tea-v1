import { BaseAgent } from "../base-agent.js";

export class BrowserAgent extends BaseAgent {
  static agentType = "browser";

  async onTask(task) {
    const toolName = task.input?.toolName;
    if (!toolName) throw new Error("Browser Agent 需要由 Plugin 指定已注册的 Browser Tool");
    const dependencyOutput = Object.values(task.dependencyOutputs || {}).find((value) => value !== null) || null;
    const result = await this.useTool(toolName, {
      ...(task.input?.toolInput || {}),
      dependencyOutput,
    });
    await this.emit("browser.completed", { result });
    return result;
  }
}
