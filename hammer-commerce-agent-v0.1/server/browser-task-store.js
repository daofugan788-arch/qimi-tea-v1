function taskId() {
  return `BRT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class BrowserTaskStore {
  constructor({ maxTasks = 100 } = {}) {
    this.maxTasks = maxTasks;
    this.tasks = new Map();
  }

  create({ goal, plan }) {
    const now = new Date().toISOString();
    const task = {
      id: taskId(),
      goal,
      status: "WAITING",
      plan,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    this.prune();
    return clone(task);
  }

  update(id, status, patch = {}) {
    const task = this.tasks.get(id);
    if (!task) return null;
    Object.assign(task, patch, { status, updatedAt: new Date().toISOString() });
    return clone(task);
  }

  get(id) {
    const task = this.tasks.get(id);
    return task ? clone(task) : null;
  }

  prune() {
    while (this.tasks.size > this.maxTasks) {
      this.tasks.delete(this.tasks.keys().next().value);
    }
  }
}
