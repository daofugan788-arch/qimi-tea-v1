import { WORKER_STATUS } from "./runtime-status.js";

function workerId() {
  return `WRK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export class RuntimeWorker {
  constructor({ agentRegistry, eventBus, toolRegistry, memoryService, decisionService } = {}) {
    this.id = workerId();
    this.agentRegistry = agentRegistry;
    this.eventBus = eventBus;
    this.toolRegistry = toolRegistry;
    this.memoryService = memoryService;
    this.decisionService = decisionService;
    this.status = WORKER_STATUS.IDLE;
    this.taskId = null;
  }

  async execute(task, mission) {
    this.status = WORKER_STATUS.RUNNING;
    this.taskId = task.id;
    const agent = this.agentRegistry.create(task.agentType, {
      missionId: mission.id,
      taskId: task.id,
      eventBus: this.eventBus,
      toolRegistry: this.toolRegistry,
      memoryService: this.memoryService,
      decisionService: this.decisionService,
    });
    try {
      const result = await agent.run(task);
      this.status = WORKER_STATUS.SUCCESS;
      return result;
    } catch (error) {
      this.status = WORKER_STATUS.FAILED;
      throw error;
    }
  }
}
