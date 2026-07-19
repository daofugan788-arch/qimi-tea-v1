export class PriorityTaskQueue {
  constructor() {
    this.items = [];
    this.sequence = 0;
  }

  enqueue(task) {
    if (this.items.some((item) => item.task.id === task.id)) return task;
    this.items.push({ task, sequence: this.sequence++ });
    this.items.sort((a, b) => b.task.priority - a.task.priority || a.sequence - b.sequence);
    return task;
  }

  dequeue() {
    return this.items.shift()?.task || null;
  }

  remove(taskId) {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.task.id !== taskId);
    return before !== this.items.length;
  }

  get size() {
    return this.items.length;
  }
}
