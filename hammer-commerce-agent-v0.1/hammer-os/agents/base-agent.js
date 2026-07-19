function agentId(type) {
  return `AGT-${String(type || "agent").toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export class BaseAgent {
  static agentType = "base";

  constructor(context = {}) {
    this.type = this.constructor.agentType;
    this.id = context.agentId || agentId(this.type);
    this.missionId = context.missionId || null;
    this.taskId = context.taskId || null;
    this.eventBus = context.eventBus;
    this.toolRegistry = context.toolRegistry;
    this.memoryService = context.memoryService;
    this.decisionService = context.decisionService;
  }

  async run(task) {
    await this.emit("agent.started", { agentType: this.type });
    try {
      const output = await this.onTask(task);
      await this.emit("agent.completed", { agentType: this.type, output });
      return output;
    } catch (error) {
      await this.emit("agent.failed", { agentType: this.type, error: error?.message || "Agent failed" });
      throw error;
    }
  }

  async onTask() {
    throw new Error(`${this.type} Agent 必须实现 onTask(task)`);
  }

  emit(type, payload = {}) {
    return this.eventBus.publish(type, payload, {
      source: `agent.${this.type}`,
      missionId: this.missionId,
      taskId: this.taskId,
    });
  }

  subscribe(type, handler) {
    return this.eventBus.subscribe(type, handler, { subscriberId: this.id });
  }

  useTool(name, input) {
    return this.toolRegistry.execute(name, input, {
      agentId: this.id,
      agentType: this.type,
      missionId: this.missionId,
      taskId: this.taskId,
    });
  }

  remember(key, value) {
    return this.memoryService.write(`agent.${this.type}`, key, value);
  }

  recall(key) {
    return this.memoryService.read(`agent.${this.type}`, key);
  }

  decide(policyId, input, context = {}) {
    return this.decisionService.evaluate(policyId, input, {
      ...context,
      agentId: this.id,
      missionId: this.missionId,
      taskId: this.taskId,
    });
  }
}
