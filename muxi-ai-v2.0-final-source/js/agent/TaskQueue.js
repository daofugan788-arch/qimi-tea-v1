import { TaskStatus, cloneTask, isTerminalTaskStatus } from "./Task.js";

const QUEUEABLE_TASK_STATUSES = new Set([
  TaskStatus.PENDING,
  TaskStatus.WAITING_CONFIRMATION,
]);

function createConfirmationError() {
  const error = new Error("此任务包含 MEDIUM 风险动作，需要手动确认后才能加入队列");
  error.code = "CONFIRMATION_REQUIRED";
  return error;
}

function emptyRunSummary() {
  return {
    processed: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    results: [],
  };
}

// 本地 FIFO 任务队列。只负责任务排序和串行调度，不包含 UI、模型或动作实现。
export class TaskQueue {
  constructor({ getTask, runTask, cancelTask } = {}) {
    if (typeof getTask !== "function") throw new Error("TaskQueue 需要 getTask 函数");
    if (typeof runTask !== "function") throw new Error("TaskQueue 需要 runTask 函数");
    this.getTask = getTask;
    this.runTask = runTask;
    this.cancelTask = typeof cancelTask === "function" ? cancelTask : null;
    this.pending = [];
    this.activeTaskId = null;
    this.isProcessing = false;
    this.drainPromise = null;
    this.listeners = new Set();
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new Error("队列监听器必须是函数");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    const safeEvent = cloneTask(event);
    for (const listener of this.listeners) {
      try {
        listener(safeEvent);
      } catch {
        // 监听器异常不能打断任务队列。
      }
    }
  }

  getSnapshot() {
    return cloneTask({
      isProcessing: this.isProcessing,
      activeTaskId: this.activeTaskId,
      pending: this.pending,
    });
  }

  has(taskId) {
    return this.activeTaskId === taskId || this.pending.some((item) => item.taskId === taskId);
  }

  enqueue(taskId, { confirmed = false } = {}) {
    const normalizedTaskId = String(taskId || "").trim();
    const task = this.getTask(normalizedTaskId);
    if (!task) throw new Error("任务不存在或已经失效");
    if (isTerminalTaskStatus(task.status)) throw new Error("已结束的任务不能加入队列");
    if (!QUEUEABLE_TASK_STATUSES.has(task.status)) throw new Error(`状态为 ${task.status} 的任务不能加入队列`);
    if (task.requiresConfirmation && !confirmed) throw createConfirmationError();
    if (this.has(normalizedTaskId)) throw new Error("任务已经在队列中");

    const item = {
      taskId: normalizedTaskId,
      confirmed: Boolean(confirmed),
      enqueuedAt: new Date().toISOString(),
    };
    this.pending.push(item);
    this.emit({
      type: "queue_item_enqueued",
      taskId: normalizedTaskId,
      position: this.pending.length,
      at: item.enqueuedAt,
    });
    return cloneTask(item);
  }

  cancelPending(taskId, reason = "用户取消了排队任务") {
    const index = this.pending.findIndex((item) => item.taskId === taskId);
    if (index < 0) return false;
    const [item] = this.pending.splice(index, 1);
    this.cancelTask?.(item.taskId, reason);
    this.emit({
      type: "queue_item_cancelled",
      taskId: item.taskId,
      reason,
      at: new Date().toISOString(),
    });
    return true;
  }

  clearPending(reason = "用户清空了待执行队列") {
    const taskIds = this.pending.map((item) => item.taskId);
    for (const taskId of taskIds) this.cancelPending(taskId, reason);
    return taskIds.length;
  }

  start() {
    if (this.isProcessing && this.drainPromise) return this.drainPromise;
    if (!this.pending.length) return Promise.resolve(emptyRunSummary());

    this.isProcessing = true;
    const promise = Promise.resolve()
      .then(() => this.drain())
      .finally(() => {
        if (this.drainPromise === promise) this.drainPromise = null;
      });
    this.drainPromise = promise;
    return promise;
  }

  waitForIdle() {
    return this.drainPromise || Promise.resolve(emptyRunSummary());
  }

  async drain() {
    const summary = emptyRunSummary();
    this.emit({ type: "queue_started", pendingCount: this.pending.length, at: new Date().toISOString() });

    try {
      while (this.pending.length) {
        const item = this.pending.shift();
        this.activeTaskId = item.taskId;
        this.emit({ type: "queue_item_started", taskId: item.taskId, at: new Date().toISOString() });

        try {
          const result = await this.runTask(item.taskId, { confirmed: item.confirmed });
          const status = result?.status || this.getTask(item.taskId)?.status || "completed";
          const cancelled = status === TaskStatus.CANCELLED;
          const failed = [TaskStatus.FAILED, TaskStatus.BLOCKED].includes(status);
          summary.processed += 1;
          summary.cancelled += cancelled ? 1 : 0;
          summary.failed += failed ? 1 : 0;
          summary.succeeded += !cancelled && !failed ? 1 : 0;
          summary.results.push({ taskId: item.taskId, status, error: result?.error || "" });
          const eventType = cancelled
            ? "queue_item_cancelled"
            : failed
              ? "queue_item_failed"
              : "queue_item_finished";
          this.emit({
            type: eventType,
            taskId: item.taskId,
            status,
            error: result?.error || "",
            at: new Date().toISOString(),
          });
        } catch (error) {
          const message = error?.message || "任务执行失败";
          const cancelled = error?.name === "AbortError" || this.getTask(item.taskId)?.status === TaskStatus.CANCELLED;
          const status = cancelled ? TaskStatus.CANCELLED : TaskStatus.FAILED;
          summary.processed += 1;
          summary.cancelled += cancelled ? 1 : 0;
          summary.failed += cancelled ? 0 : 1;
          summary.results.push({ taskId: item.taskId, status, error: message });
          this.emit({
            type: cancelled ? "queue_item_cancelled" : "queue_item_failed",
            taskId: item.taskId,
            status,
            error: message,
            at: new Date().toISOString(),
          });
        } finally {
          this.activeTaskId = null;
        }
      }
      return cloneTask(summary);
    } finally {
      this.activeTaskId = null;
      this.isProcessing = false;
      this.emit({ type: "queue_idle", summary, at: new Date().toISOString() });
    }
  }
}

export { QUEUEABLE_TASK_STATUSES };
