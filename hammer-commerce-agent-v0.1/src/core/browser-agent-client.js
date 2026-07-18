export class BrowserAgentClient {
  constructor({ baseUrl = "", fetchImpl = globalThis.fetch, timeout = 45000 } = {}) {
    const value = String(baseUrl || "").trim().replace(/\/$/, "");
    this.endpoint = value
      ? value.endsWith("/api/browser/search") ? value : `${value}/api/browser/search`
      : "";
    this.fetchImpl = fetchImpl;
    this.timeout = timeout;
  }

  get enabled() {
    return Boolean(this.endpoint && typeof this.fetchImpl === "function");
  }

  async search({ goal, plan }) {
    if (!this.enabled) throw new Error("Browser Agent 服务尚未连接");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, plan }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Browser Agent 请求失败：${response.status}`);
      if (!Array.isArray(payload.items)) throw new Error("Browser Agent 返回格式不正确");
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Browser Agent 搜索超时");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
