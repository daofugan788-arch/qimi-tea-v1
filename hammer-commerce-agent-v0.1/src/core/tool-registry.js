export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    if (!tool?.name || typeof tool.execute !== "function") {
      throw new Error("工具必须提供 name 和 execute");
    }
    if (this.tools.has(tool.name)) throw new Error(`工具已注册：${tool.name}`);
    this.tools.set(tool.name, Object.freeze({
      riskLevel: "LOW",
      ...tool,
      execute: tool.execute.bind(tool),
    }));
    return this;
  }

  get(name) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`未找到工具：${name}`);
    return tool;
  }

  list() {
    return [...this.tools.values()].map(({ execute, ...meta }) => meta);
  }

  async execute(name, input, context = {}) {
    return this.get(name).execute(input, context);
  }
}
