import assert from "node:assert/strict";
import { AutomationEngine } from "../js/automation/AutomationEngine.js";
import { AutomationRepository } from "../js/automation/AutomationRepository.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.get(key) || null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}

class QueueTestExecutor {
  constructor() {
    this.activeCount = 0;
    this.maxActiveCount = 0;
    this.executionOrder = [];
    this.failNextRoute = "";
  }

  async execute(action) {
    this.activeCount += 1;
    this.maxActiveCount = Math.max(this.maxActiveCount, this.activeCount);
    this.executionOrder.push(action.params?.route || action.type);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (action.params?.route && action.params.route === this.failNextRoute) {
        this.failNextRoute = "";
        throw new Error("模拟队列任务失败");
      }
      return { status: "completed", message: "测试步骤完成" };
    } finally {
      this.activeCount -= 1;
    }
  }
}

const repository = new AutomationRepository({
  storage: new MemoryStorage(),
  key: "test.task.queue",
});
const executor = new QueueTestExecutor();
const engine = new AutomationEngine({ executor, repository });
const queueEvents = [];
const unsubscribe = engine.subscribeTaskQueue((event) => queueEvents.push(event));

// FIFO：多个任务按进入顺序执行，并且同一时间只有一个任务运行。
const first = engine.createTask("打开设置");
const second = engine.createTask("打开聊天");
engine.enqueueTask(first.id);
engine.enqueueTask(second.id);
assert.throws(() => engine.enqueueTask(first.id), /已经在队列中/);

const externalSnapshot = engine.getTaskQueueSnapshot();
externalSnapshot.pending.length = 0;
assert.equal(engine.getTaskQueueSnapshot().pending.length, 2);

const firstRun = await engine.runTaskQueue();
assert.equal(firstRun.processed, 2);
assert.equal(firstRun.succeeded, 2);
assert.equal(firstRun.failed, 0);
assert.equal(engine.getTask(first.id).status, "completed");
assert.equal(engine.getTask(second.id).status, "completed");
assert.deepEqual(firstRun.results.map((item) => item.taskId), [first.id, second.id]);
assert.deepEqual(executor.executionOrder.slice(0, 4), ["settings", "show_message", "chat", "show_message"]);
assert.equal(executor.maxActiveCount, 1);
assert.equal(engine.getTaskQueueSnapshot().pending.length, 0);
assert.equal(engine.getTaskQueueSnapshot().activeTaskId, null);

// MEDIUM 任务必须先确认，确认后才能进入队列。
const medium = engine.createTask("启动暮曦");
assert.throws(
  () => engine.enqueueTask(medium.id),
  (error) => error.code === "CONFIRMATION_REQUIRED",
);
engine.enqueueTask(medium.id, { confirmed: true });
const mediumRun = await engine.runTaskQueue();
assert.equal(mediumRun.succeeded, 1);
assert.equal(engine.getTask(medium.id).status, "completed");

// 未开始的排队任务可以取消，取消后沿用 Sprint 01 状态管理和原有历史记录。
const cancelled = engine.createTask("打开设置");
engine.enqueueTask(cancelled.id);
assert.equal(engine.cancelQueuedTask(cancelled.id), true);
assert.equal(engine.cancelQueuedTask(cancelled.id), false);
assert.equal(engine.getTask(cancelled.id).status, "cancelled");
assert.equal(engine.getTaskQueueSnapshot().pending.length, 0);

// 单个任务失败不会阻塞后续任务。
executor.failNextRoute = "settings";
const failing = engine.createTask("打开设置");
const afterFailure = engine.createTask("打开聊天");
engine.enqueueTask(failing.id);
engine.enqueueTask(afterFailure.id);
const failureRun = await engine.runTaskQueue();
assert.equal(failureRun.processed, 2);
assert.equal(failureRun.failed, 1);
assert.equal(failureRun.succeeded, 1);
assert.equal(engine.getTask(failing.id).status, "failed");
assert.equal(engine.getTask(afterFailure.id).status, "completed");

unsubscribe();
assert.ok(queueEvents.some((event) => event.type === "queue_item_enqueued"));
assert.ok(queueEvents.some((event) => event.type === "queue_item_started"));
assert.ok(queueEvents.some((event) => event.type === "queue_item_failed"));
assert.ok(queueEvents.some((event) => event.type === "queue_item_cancelled"));
assert.ok(queueEvents.some((event) => event.type === "queue_idle"));

console.log(JSON.stringify({
  fifoOrder: "passed",
  maxConcurrentTasks: executor.maxActiveCount,
  confirmationRequired: true,
  pendingCancellation: "passed",
  failureIsolation: "passed",
  immutableSnapshots: true,
  queueEvents: queueEvents.length,
}, null, 2));
