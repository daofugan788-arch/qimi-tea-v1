const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const CATEGORIES = new Set(["rules", "market", "platform", "experience"]);

export class KnowledgeCenter {
  constructor({ memoryService = null, eventBus = null, now = () => new Date() } = {}) {
    this.memoryService = memoryService;
    this.eventBus = eventBus;
    this.now = now;
    this.fallback = new Map();
  }

  namespace(category) {
    if (!CATEGORIES.has(category)) throw new Error(`Knowledge category 不支持：${category}`);
    return `employee.knowledge.${category}`;
  }

  async write(category, key, value, { author = "system", source = "" } = {}) {
    const record = {
      category,
      key: String(key),
      value: clone(value),
      author: String(author),
      source: String(source || ""),
      updatedAt: this.now().toISOString(),
    };
    const namespace = this.namespace(category);
    if (this.memoryService) await this.memoryService.write(namespace, record.key, record);
    else this.fallback.set(`${namespace}:${record.key}`, record);
    await this.eventBus?.publish("employee.knowledge.updated", { category, key: record.key, author: record.author }, { source: "employee.knowledge-center" });
    return clone(record);
  }

  async read(category, key) {
    const namespace = this.namespace(category);
    const record = this.memoryService
      ? await this.memoryService.read(namespace, String(key))
      : this.fallback.get(`${namespace}:${String(key)}`);
    return clone(record);
  }

  async list(category) {
    const namespace = this.namespace(category);
    if (this.memoryService) return (await this.memoryService.list(namespace)).map((entry) => clone(entry.value));
    return [...this.fallback.entries()].filter(([key]) => key.startsWith(`${namespace}:`)).map(([, value]) => clone(value));
  }
}
