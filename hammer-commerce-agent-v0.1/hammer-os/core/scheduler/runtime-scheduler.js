export class RuntimeScheduler {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.scheduled = new Map();
  }

  schedule(task, runAt) {
    const timestamp = new Date(runAt).getTime();
    if (!Number.isFinite(timestamp)) throw new Error("Schedule 时间无效");
    this.scheduled.set(task.id, { task, runAt: new Date(timestamp).toISOString() });
    return this.scheduled.get(task.id);
  }

  due() {
    const now = this.now();
    const ready = [];
    for (const [id, item] of this.scheduled) {
      if (new Date(item.runAt).getTime() <= now) {
        ready.push(item.task);
        this.scheduled.delete(id);
      }
    }
    return ready;
  }

  cancel(taskId) {
    return this.scheduled.delete(taskId);
  }

  list() {
    return [...this.scheduled.values()].map((item) => ({ taskId: item.task.id, runAt: item.runAt }));
  }
}
