import {
  ActionStatus,
  TaskStatus,
  assertTask,
  cloneTask,
  isTerminalActionStatus,
  isTerminalTaskStatus,
} from "./Task.js";

const TASK_TRANSITIONS = Object.freeze({
  [TaskStatus.PENDING]: new Set([TaskStatus.RUNNING, TaskStatus.BLOCKED, TaskStatus.CANCELLED]),
  [TaskStatus.WAITING_CONFIRMATION]: new Set([TaskStatus.RUNNING, TaskStatus.BLOCKED, TaskStatus.CANCELLED]),
  [TaskStatus.RUNNING]: new Set([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]),
  [TaskStatus.COMPLETED]: new Set(),
  [TaskStatus.BLOCKED]: new Set(),
  [TaskStatus.FAILED]: new Set(),
  [TaskStatus.CANCELLED]: new Set(),
});

const ACTION_TRANSITIONS = Object.freeze({
  [ActionStatus.PENDING]: new Set([ActionStatus.RUNNING, ActionStatus.BLOCKED, ActionStatus.CANCELLED]),
  [ActionStatus.WAITING_CONFIRMATION]: new Set([ActionStatus.RUNNING, ActionStatus.BLOCKED, ActionStatus.CANCELLED]),
  [ActionStatus.RUNNING]: new Set([
    ActionStatus.COMPLETED,
    ActionStatus.EXTERNAL_REQUIRED,
    ActionStatus.BLOCKED,
    ActionStatus.FAILED,
    ActionStatus.CANCELLED,
  ]),
  [ActionStatus.COMPLETED]: new Set(),
  [ActionStatus.EXTERNAL_REQUIRED]: new Set(),
  [ActionStatus.BLOCKED]: new Set(),
  [ActionStatus.FAILED]: new Set(),
  [ActionStatus.CANCELLED]: new Set(),
});

function assertTransition(map, current, next, label) {
  if (current === next) return;
  if (!map[current]?.has(next)) throw new Error(`${label} 状态不能从 ${current} 变更为 ${next}`);
}

export class TaskStateManager {
  constructor() {
    this.tasks = new Map();
    this.listeners = new Set();
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new Error("状态监听器必须是函数");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    const safeEvent = cloneTask(event);
    for (const listener of this.listeners) listener(safeEvent);
  }

  register(task) {
    assertTask(task);
    if (this.tasks.has(task.id)) throw new Error("Task id 已存在");
    const stored = cloneTask(task);
    this.tasks.set(stored.id, stored);
    this.emit({ type: "task_registered", taskId: stored.id, status: stored.status, at: stored.createdAt });
    return cloneTask(stored);
  }

  get(taskId) {
    const task = this.tasks.get(taskId);
    return task ? cloneTask(task) : null;
  }

  getMutable(taskId) {
    return this.tasks.get(taskId) || null;
  }

  transitionTask(taskId, nextStatus, { error } = {}) {
    const task = this.getMutable(taskId);
    if (!task) throw new Error("任务不存在或已经失效");
    assertTransition(TASK_TRANSITIONS, task.status, nextStatus, "Task");
    const previousStatus = task.status;
    const now = new Date().toISOString();
    task.status = nextStatus;
    task.updatedAt = now;
    if (nextStatus === TaskStatus.RUNNING && !task.startedAt) task.startedAt = now;
    if (isTerminalTaskStatus(nextStatus)) task.finishedAt = now;
    if (error !== undefined) task.error = String(error || "");
    this.emit({ type: "task_status_changed", taskId, previousStatus, status: nextStatus, at: now, error: task.error });
    return cloneTask(task);
  }

  transitionAction(taskId, actionId, nextStatus, { error } = {}) {
    const task = this.getMutable(taskId);
    if (!task) throw new Error("任务不存在或已经失效");
    const action = task.actions.find((item) => item.id === actionId);
    if (!action) throw new Error("任务步骤不存在");
    assertTransition(ACTION_TRANSITIONS, action.status, nextStatus, "Action");
    const previousStatus = action.status;
    const now = new Date().toISOString();
    action.status = nextStatus;
    if (nextStatus === ActionStatus.RUNNING && !action.startedAt) action.startedAt = now;
    if (isTerminalActionStatus(nextStatus)) action.finishedAt = now;
    if (error !== undefined) action.error = String(error || "");
    task.updatedAt = now;
    this.emit({ type: "action_status_changed", taskId, actionId, previousStatus, status: nextStatus, at: now, error: action.error || "" });
    return cloneTask(action);
  }

  cancel(taskId, reason = "用户取消了任务") {
    const task = this.getMutable(taskId);
    if (!task || isTerminalTaskStatus(task.status)) return false;
    for (const action of task.actions) {
      if (!isTerminalActionStatus(action.status)) this.transitionAction(taskId, action.id, ActionStatus.CANCELLED, { error: reason });
    }
    this.transitionTask(taskId, TaskStatus.CANCELLED, { error: reason });
    return true;
  }
}

export { TASK_TRANSITIONS, ACTION_TRANSITIONS };
