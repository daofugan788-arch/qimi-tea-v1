import { createTask } from "./Task.js";
import { TaskStateManager } from "./TaskStateManager.js";

// Agent Core 只管理任务模型与生命周期，不包含 UI、模型或具体执行器逻辑。
export class AgentCore {
  constructor({ stateManager } = {}) {
    this.stateManager = stateManager || new TaskStateManager();
  }

  createTask(specification) {
    return this.stateManager.register(createTask(specification));
  }

  getTask(taskId) {
    return this.stateManager.get(taskId);
  }

  getMutableTask(taskId) {
    return this.stateManager.getMutable(taskId);
  }

  transitionTask(taskId, status, details) {
    return this.stateManager.transitionTask(taskId, status, details);
  }

  transitionAction(taskId, actionId, status, details) {
    return this.stateManager.transitionAction(taskId, actionId, status, details);
  }

  cancelTask(taskId, reason) {
    return this.stateManager.cancel(taskId, reason);
  }

  subscribe(listener) {
    return this.stateManager.subscribe(listener);
  }
}
