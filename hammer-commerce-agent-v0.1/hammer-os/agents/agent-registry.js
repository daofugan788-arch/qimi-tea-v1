export class AgentRegistry {
  constructor() {
    this.agents = new Map();
  }

  register(AgentClass, { pluginId = "core" } = {}) {
    const type = AgentClass?.agentType;
    if (!type || typeof AgentClass !== "function") throw new Error("Agent 必须继承 BaseAgent 并声明 static agentType");
    if (this.agents.has(type)) throw new Error(`Agent 已注册：${type}`);
    this.agents.set(type, { AgentClass, pluginId });
    return this;
  }

  create(type, context) {
    const entry = this.agents.get(type);
    if (!entry) throw new Error(`Agent 未注册：${type}`);
    return new entry.AgentClass(context);
  }

  list() {
    return [...this.agents.entries()].map(([type, entry]) => ({ type, pluginId: entry.pluginId }));
  }
}
