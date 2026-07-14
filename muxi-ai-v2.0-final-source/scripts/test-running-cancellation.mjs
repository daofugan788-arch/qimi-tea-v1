import assert from "node:assert/strict";
import { ExecutorStatus } from "../js/agent/AgentExecutor.js";
import { ActionStatus, TaskStatus } from "../js/agent/Task.js";
import { AutomationEngine } from "../js/automation/AutomationEngine.js";
import { AutomationRepository } from "../js/automation/AutomationRepository.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.get(key) || null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}

class CancellableActionExecutor {
  constructor() {
    this.callCount = 0;
    this.resourceReleased = false;
    this.started = new Promise((resolve) => { this.resolveStarted = resolve; });
  }

  async execute(action, { signal } = {}) {
    this.callCount += 1;
    if (this.callCount > 1) {
      return { status: ActionStatus.COMPLETED, message: "取消后的下一项任务执行成功" };
    }

    this.resolveStarted(action.type);
    try {
      await new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("任务已取消", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("任务已取消", "AbortError")),
          { once: true },
        );
      });
      return { status: ActionStatus.COMPLETED, message: "不应到达此处" };
    } finally {
      this.resourceReleased = true;
    }
  }
}

const repository = new AutomationRepository({
  storage: new MemoryStorage(),
  key: "test.running.cancellation",
});
const actionExecutor = new CancellableActionExecutor();
const engine = new AutomationEngine({ executor: actionExecutor, repository });
const taskEvents = [];
const executorEvents = [];
const queueEvents = [];
engine.agentCore.subscribe((event) => taskEvents.push(event));
engine.subscribeTaskExecution((event) => executorEvents.push(event));
engine.subscribeTaskQueue((event) => queueEvents.push(event));

const task = engine.createTask("打开设置");
engine.enqueueTask(task.id);
const runPromise = engine.runTaskQueue();
await Promise.race([
  actionExecutor.started,
  new Promise((_, reject) => setTimeout(() => reject(new Error("等待任务进入 running 超时")), 2000)),
]);

assert.equal(engine.getTask(task.id).status, TaskStatus.RUNNING);
assert.equal(engine.activeTaskId, task.id);
assert.ok(engine.activeController);
assert.equal(engine.getTaskQueueSnapshot().activeTaskId, task.id);
assert.equal(engine.cancelCurrentTask(), true);
assert.equal(engine.cancelCurrentTask(), false);

const summary = await runPromise;
const cancelledTask = engine.getTask(task.id);
const cancelledExecution = engine.getTaskExecution(task.id);

assert.equal(cancelledTask.status, TaskStatus.CANCELLED);
assert.ok(cancelledTask.finishedAt);
assert.ok(cancelledTask.actions.every((action) => action.status === ActionStatus.CANCELLED));
assert.equal(cancelledExecution.status, ExecutorStatus.CANCELLED);
assert.ok(cancelledExecution.finishedAt);
assert.equal(summary.processed, 1);
assert.equal(summary.cancelled, 1);
assert.equal(summary.failed, 0);
assert.equal(summary.succeeded, 0);
assert.equal(summary.results[0].status, TaskStatus.CANCELLED);
assert.equal(actionExecutor.resourceReleased, true);
assert.equal(engine.activeController, null);
assert.equal(engine.activeTaskId, null);
assert.equal(engine.getTaskQueueSnapshot().activeTaskId, null);
assert.equal(engine.getTaskQueueSnapshot().isProcessing, false);
assert.equal(engine.getTaskQueueSnapshot().pending.length, 0);
assert.equal(engine.taskQueue.drainPromise, null);

const taskStatusSequence = taskEvents
  .filter((event) => event.taskId === task.id && ["task_registered", "task_status_changed"].includes(event.type))
  .map((event) => event.status);
const executorStatusSequence = executorEvents
  .filter((event) => event.taskId === task.id)
  .map((event) => event.status);
assert.deepEqual(taskStatusSequence, [TaskStatus.PENDING, TaskStatus.RUNNING, TaskStatus.CANCELLED]);
assert.deepEqual(executorStatusSequence, [
  ExecutorStatus.PENDING,
  ExecutorStatus.RUNNING,
  ExecutorStatus.CANCELLED,
]);
assert.ok(queueEvents.some((event) => event.type === "queue_item_cancelled" && event.taskId === task.id));
assert.ok(!queueEvents.some((event) => event.type === "queue_item_failed" && event.taskId === task.id));

// 取消完成后再次排队执行，验证控制器和队列资源已真正释放。
const nextTask = engine.createTask("打开聊天");
engine.enqueueTask(nextTask.id);
const nextSummary = await engine.runTaskQueue();
assert.equal(nextSummary.succeeded, 1);
assert.equal(nextSummary.failed, 0);
assert.equal(nextSummary.cancelled, 0);
assert.equal(engine.getTask(nextTask.id).status, TaskStatus.COMPLETED);
assert.equal(engine.getTaskExecution(nextTask.id).status, ExecutorStatus.SUCCESS);
assert.equal(engine.activeController, null);
assert.equal(engine.activeTaskId, null);
assert.equal(engine.getTaskQueueSnapshot().isProcessing, false);

console.log(JSON.stringify({
  suite: "muxi-ai-v2.0-final running task cancellation",
  taskStatusSequence,
  executorStatusSequence,
  queueSummary: {
    processed: summary.processed,
    cancelled: summary.cancelled,
    failed: summary.failed,
    succeeded: summary.succeeded,
  },
  duplicateCancelRejected: true,
  allActionsCancelled: true,
  resourceReleased: actionExecutor.resourceReleased,
  controllerReleased: engine.activeController === null,
  queueReleased: !engine.getTaskQueueSnapshot().isProcessing,
  nextTaskSucceeded: true,
  supportedExecutorStatuses: Object.values(ExecutorStatus),
}, null, 2));
