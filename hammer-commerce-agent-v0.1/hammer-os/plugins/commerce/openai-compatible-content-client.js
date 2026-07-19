export class OpenAICompatibleContentClient {
  constructor({ baseUrl = "", apiKey = "", model = "", fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  get enabled() {
    return Boolean(this.baseUrl && this.apiKey && this.model && typeof this.fetchImpl === "function");
  }

  async generate({ product, channel }) {
    if (!this.enabled) throw new Error("AI 内容接口未配置");
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [{
          role: "system",
          content: "你是个人卖家的商品资料助手。只根据给定事实写内容，不编造库存、销量、功效或发货承诺。输出 JSON：title, description, sellingPoints[], imageAdvice[], customerService{price,discount,shipping,stock}。",
        }, {
          role: "user",
          content: JSON.stringify({ channel, product }),
        }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || `AI 内容接口失败：${response.status}`);
    const content = payload.choices?.[0]?.message?.content;
    const result = JSON.parse(content || "{}");
    if (!result.title || !result.description) throw new Error("AI 内容返回格式不完整");
    return result;
  }
}
