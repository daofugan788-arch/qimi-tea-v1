import { TOOL_RISK, TOOL_TYPE } from "./tool-types.js";

export class ToolRegistry {
  constructor({ eventBus = null } = {}) {
    this.eventBus = eventBus;
    this.tools = new Map();
  }

  register(tool, { pluginId = "core" } = {}) {
    if (!tool?.name || typeof tool.execute !== "function") throw new Error("Tool 必须提供 name 和 execute");
    if (this.tools.has(tool.name)) throw new Error(`Tool 已注册：${tool.name}`);
    const type = tool.type || TOOL_TYPE.PLUGIN;
    if (!Object.values(TOOL_TYPE).includes(type)) throw new Error(`Tool type 无效：${type}`);
    this.tools.set(tool.name, {
      tool,
      metadata: {
        pluginId,
        type,
        riskLevel: tool.riskLevel || TOOL_RISK.LOW,
        description: tool.description || "",
      },
    });
    return this;
  }

  async execute(name, input, context = {}) {
    const entry = this.tools.get(name);
    if (!entry) throw new Error(`Tool 未注册：${name}`);
    await this.eventBus?.publish("tool.started", { name, type: entry.metadata.type }, {
      source: "tools.registry",
      missionId: context.missionId,
      taskId: context.taskId,
    });
    try {
      const output = await entry.tool.execute(input, { ...context, metadata: entry.metadata });
      await this.eventBus?.publish("tool.completed", { name, output }, {
        source: "tools.registry",
        missionId: context.missionId,
        taskId: context.taskId,
      });
      return output;
    } catch (error) {
      await this.eventBus?.publish("tool.failed", { name, error: error?.message || "Tool failed" }, {
        source: "tools.registry",
        missionId: context.missionId,
        taskId: context.taskId,
      });
      throw error;
    }
  }

  list({ type = null } = {}) {
    return [...this.tools.entries()]
      .map(([name, entry]) => ({ name, ...entry.metadata }))
      .filter((entry) => !type || entry.type === type);
  }
}
