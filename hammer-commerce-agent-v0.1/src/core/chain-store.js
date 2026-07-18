import { CHAIN_STATUS } from "./chain-status.js";

export const CHAIN_STORAGE_KEY = "hammer-commerce-agent-v0.4-chains";

const clone = (value) => JSON.parse(JSON.stringify(value));

function chainId() {
  return `CHN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export class ChainStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
  }

  list() {
    try {
      const chains = JSON.parse(this.storage?.getItem(CHAIN_STORAGE_KEY) || "[]");
      return Array.isArray(chains) ? chains : [];
    } catch {
      return [];
    }
  }

  get(id) {
    return this.list().find((chain) => chain.id === id) || null;
  }

  create(goal, steps) {
    const now = new Date().toISOString();
    const chain = {
      id: chainId(),
      goal: String(goal || "").trim(),
      status: CHAIN_STATUS.WAITING,
      steps: clone(steps),
      currentStepIndex: 0,
      context: { outputs: {}, signals: {}, attemptedProductIds: [], attempts: [] },
      blocked: null,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    if (!chain.goal) throw new Error("请输入任务链目标");
    this.save(chain);
    return clone(chain);
  }

  update(id, changes) {
    const chains = this.list();
    const index = chains.findIndex((chain) => chain.id === id);
    if (index < 0) throw new Error(`任务链不存在：${id}`);
    const updated = { ...chains[index], ...clone(changes), id, updatedAt: new Date().toISOString() };
    chains[index] = updated;
    this.write(chains);
    return clone(updated);
  }

  save(chain) {
    const chains = this.list();
    const index = chains.findIndex((item) => item.id === chain.id);
    if (index >= 0) chains[index] = clone(chain);
    else chains.unshift(clone(chain));
    this.write(chains);
    return clone(chain);
  }

  write(chains) {
    this.storage?.setItem(CHAIN_STORAGE_KEY, JSON.stringify(chains.slice(0, 30)));
  }
}
