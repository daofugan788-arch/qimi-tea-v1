import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export class JsonFileMemoryAdapter {
  constructor(filePath) {
    if (!filePath) throw new Error("JsonFileMemoryAdapter 缺少文件路径");
    this.filePath = path.resolve(filePath);
    this.data = null;
    this.writeChain = Promise.resolve();
  }

  async load() {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await readFile(this.filePath, "utf-8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.data = {};
    }
    return this.data;
  }

  async persist() {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, snapshot, "utf-8");
      await rename(temporaryPath, this.filePath);
    });
    return this.writeChain;
  }

  async get(namespace, key) {
    const data = await this.load();
    return clone(data[namespace]?.[key]);
  }

  async set(namespace, key, value) {
    const data = await this.load();
    data[namespace] ||= {};
    data[namespace][key] = clone(value);
    await this.persist();
    return clone(value);
  }

  async delete(namespace, key) {
    const data = await this.load();
    if (!Object.hasOwn(data[namespace] || {}, key)) return false;
    delete data[namespace][key];
    await this.persist();
    return true;
  }

  async entries(namespace) {
    const data = await this.load();
    return Object.entries(data[namespace] || {}).map(([key, value]) => ({ key, value: clone(value) }));
  }
}
