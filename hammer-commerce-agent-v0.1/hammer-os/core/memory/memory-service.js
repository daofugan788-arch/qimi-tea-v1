const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export class InMemoryMemoryAdapter {
  constructor() {
    this.namespaces = new Map();
  }

  async get(namespace, key) {
    return clone(this.namespaces.get(namespace)?.get(key));
  }

  async set(namespace, key, value) {
    if (!this.namespaces.has(namespace)) this.namespaces.set(namespace, new Map());
    this.namespaces.get(namespace).set(key, clone(value));
    return clone(value);
  }

  async delete(namespace, key) {
    return this.namespaces.get(namespace)?.delete(key) || false;
  }

  async entries(namespace) {
    return [...(this.namespaces.get(namespace)?.entries() || [])].map(([key, value]) => ({ key, value: clone(value) }));
  }
}

export class MemoryService {
  constructor({ adapter = new InMemoryMemoryAdapter(), eventBus = null } = {}) {
    this.adapter = adapter;
    this.eventBus = eventBus;
    this.unsubscribe = eventBus?.subscribe("*", (event) => this.write("events", event.id, event), {
      subscriberId: "core.memory-service",
    });
  }

  read(namespace, key) {
    return this.adapter.get(namespace, key);
  }

  write(namespace, key, value) {
    if (!namespace || !key) throw new Error("Memory namespace 和 key 不能为空");
    return this.adapter.set(namespace, key, value);
  }

  remove(namespace, key) {
    return this.adapter.delete(namespace, key);
  }

  list(namespace) {
    return this.adapter.entries(namespace);
  }

  async append(namespace, key, value) {
    const current = await this.read(namespace, key);
    const next = [...(Array.isArray(current) ? current : []), clone(value)];
    await this.write(namespace, key, next);
    return next;
  }

  close() {
    this.unsubscribe?.();
  }
}
