const DEFAULT_KEY = "muxi.messages.v1";
const VALID_ROLES = new Set(["user", "assistant"]);

function createId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class ChatRepository {
  constructor({ storage = globalThis.localStorage, key = DEFAULT_KEY } = {}) {
    this.storage = storage;
    this.key = key;
  }

  notify() {
    globalThis.window?.dispatchEvent?.(new CustomEvent("muxi:data-change", {
      detail: { key: this.key },
    }));
  }

  getAll() {
    try {
      const data = JSON.parse(this.storage.getItem(this.key) || "[]");
      if (!Array.isArray(data)) return [];
      return data.filter((item) => item?.content && VALID_ROLES.has(item?.role));
    } catch {
      return [];
    }
  }

  save(messages) {
    const safeMessages = Array.isArray(messages) ? messages.slice(-200) : [];
    this.storage.setItem(this.key, JSON.stringify(safeMessages));
    this.notify();
    return safeMessages;
  }

  add(role, content, metadata = {}) {
    if (!VALID_ROLES.has(role)) throw new Error("不支持的聊天角色");
    const message = {
      id: createId(),
      role,
      content: String(content || "").trim(),
      createdAt: new Date().toISOString(),
      ...metadata,
    };
    if (!message.content) throw new Error("聊天内容不能为空");
    this.save([...this.getAll(), message]);
    return message;
  }

  delete(messageId) {
    return this.save(this.getAll().filter((message) => message.id !== messageId));
  }

  clear() {
    this.save([]);
  }

  newChat() {
    this.clear();
  }

  replaceAll(messages) {
    return this.save(messages);
  }
}

export const chatRepository = new ChatRepository();
