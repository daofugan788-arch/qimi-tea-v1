import { TASK_STATUS } from "./task-status.js";

export const TASK_STORAGE_KEY = "hammer-commerce-agent-v0.1-tasks";

function createId(now = Date.now()) {
  const time = Number(now).toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `HCA-${time}-${random}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class TaskStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
  }

  list() {
    try {
      const saved = JSON.parse(this.storage?.getItem(TASK_STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  get(id) {
    return this.list().find((task) => task.id === id) || null;
  }

  create(goal) {
    const normalizedGoal = String(goal || "").trim();
    if (!normalizedGoal) throw new Error("请输入你想完成的电商目标");
    const now = Date.now();
    const task = {
      id: createId(now),
      goal: normalizedGoal,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      status: TASK_STATUS.WAITING,
      steps: [],
      result: null,
      error: null,
    };
    this.save(task);
    return clone(task);
  }

  update(id, changes) {
    const tasks = this.list();
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) throw new Error(`任务不存在：${id}`);
    const updated = {
      ...tasks[index],
      ...clone(changes),
      id,
      updatedAt: new Date().toISOString(),
    };
    tasks[index] = updated;
    this.write(tasks);
    return clone(updated);
  }

  save(task) {
    const tasks = this.list();
    const index = tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) tasks[index] = clone(task);
    else tasks.unshift(clone(task));
    this.write(tasks);
    return clone(task);
  }

  clear() {
    this.storage?.removeItem(TASK_STORAGE_KEY);
  }

  write(tasks) {
    this.storage?.setItem(TASK_STORAGE_KEY, JSON.stringify(tasks.slice(0, 50)));
  }
}
