// 自动化数据只保存在当前浏览器本地，不读取其他应用数据。
const DEFAULT_KEY = "muxi.automation.v2";
const MAX_HISTORY = 100;

const DEFAULT_SHORTCUTS = [
  { id: "shortcut-start", label: "启动暮曦", command: "启动暮曦" },
  { id: "shortcut-check", label: "检查服务", command: "检查暮曦服务" },
  { id: "shortcut-restart", label: "重启暮曦", command: "重启暮曦" },
  { id: "shortcut-deploy", label: "部署新版", command: "部署新版" },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyState() {
  return { version: 2, workflows: [], shortcuts: clone(DEFAULT_SHORTCUTS), history: [] };
}

export class AutomationRepository {
  constructor({ storage = globalThis.localStorage, key = DEFAULT_KEY } = {}) {
    this.storage = storage;
    this.key = key;
  }

  read() {
    try {
      const data = JSON.parse(this.storage?.getItem?.(this.key) || "null");
      if (!data || typeof data !== "object") return emptyState();
      return {
        version: 2,
        workflows: Array.isArray(data.workflows) ? data.workflows : [],
        shortcuts: Array.isArray(data.shortcuts) && data.shortcuts.length ? data.shortcuts : clone(DEFAULT_SHORTCUTS),
        history: Array.isArray(data.history) ? data.history.slice(0, MAX_HISTORY) : [],
      };
    } catch {
      return emptyState();
    }
  }

  write(state) {
    const safe = {
      version: 2,
      workflows: Array.isArray(state.workflows) ? state.workflows.slice(0, 50) : [],
      shortcuts: Array.isArray(state.shortcuts) ? state.shortcuts.slice(0, 20) : clone(DEFAULT_SHORTCUTS),
      history: Array.isArray(state.history) ? state.history.slice(0, MAX_HISTORY) : [],
    };
    this.storage?.setItem?.(this.key, JSON.stringify(safe));
    globalThis.window?.dispatchEvent?.(new CustomEvent("muxi:data-change", { detail: { key: this.key } }));
    return clone(safe);
  }

  getHistory() {
    return clone(this.read().history);
  }

  addHistory(record) {
    const state = this.read();
    state.history = [clone(record), ...state.history.filter((item) => item.id !== record.id)].slice(0, MAX_HISTORY);
    this.write(state);
    return clone(record);
  }

  updateHistory(taskId, updater) {
    const state = this.read();
    const index = state.history.findIndex((item) => item.id === taskId);
    if (index < 0) return null;
    const current = clone(state.history[index]);
    const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
    state.history[index] = { ...next, updatedAt: new Date().toISOString() };
    this.write(state);
    return clone(state.history[index]);
  }

  clearHistory() {
    const state = this.read();
    state.history = [];
    this.write(state);
  }

  getWorkflows() {
    return clone(this.read().workflows);
  }

  saveWorkflow(workflow) {
    const state = this.read();
    state.workflows = [clone(workflow), ...state.workflows.filter((item) => item.id !== workflow.id)].slice(0, 50);
    this.write(state);
    return clone(workflow);
  }

  getShortcuts() {
    return clone(this.read().shortcuts);
  }

  exportData() {
    return this.read();
  }

  importData(data) {
    if (!data || typeof data !== "object") throw new Error("自动化备份格式不正确");
    return this.write({ ...emptyState(), ...data, version: 2 });
  }

  clearAll() {
    this.storage?.removeItem?.(this.key);
  }
}

export const automationRepository = new AutomationRepository();

