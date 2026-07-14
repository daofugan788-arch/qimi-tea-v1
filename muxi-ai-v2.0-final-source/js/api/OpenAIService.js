export class OpenAIServiceError extends Error {
  constructor(message, { code = "API_ERROR", status = 0, details = null } = {}) {
    super(message);
    this.name = "OpenAIServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class OpenAIService {
  constructor({ baseURL, apiKey, fetchImpl = globalThis.fetch } = {}) {
    this.baseURL = String(baseURL || "").trim();
    this.apiKey = String(apiKey || "").trim();
    this.fetchImpl = fetchImpl;
  }

  get chatCompletionsURL() {
    const base = this.baseURL.replace(/\/+$/, "");
    if (/\/chat\/completions$/i.test(base)) return base;
    return `${base}/chat/completions`;
  }

  async createChatCompletion({
    model,
    messages,
    temperature = 0.8,
    maxTokens = 1024,
    stream = false,
    signal,
  }) {
    if (!this.baseURL) throw new OpenAIServiceError("请填写 Base URL", { code: "MISSING_BASE_URL" });
    if (!this.apiKey) throw new OpenAIServiceError("请填写 API Key", { code: "MISSING_API_KEY" });
    if (!model) throw new OpenAIServiceError("请填写模型名称", { code: "MISSING_MODEL" });
    if (!Array.isArray(messages) || !messages.length) {
      throw new OpenAIServiceError("没有可发送的聊天内容", { code: "EMPTY_MESSAGES" });
    }

    let response;
    try {
      response = await this.fetchImpl(this.chatCompletionsURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: String(model).trim(),
          messages,
          temperature: Number(temperature),
          max_tokens: Number(maxTokens),
          stream: Boolean(stream),
        }),
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new OpenAIServiceError("网络异常，请检查网络或 Base URL", {
        code: "NETWORK_ERROR",
        details: error?.message || null,
      });
    }

    if (stream) {
      throw new OpenAIServiceError("流式输出接口已预留，当前版本暂未启用", {
        code: "STREAM_NOT_ENABLED",
      });
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new OpenAIServiceError("模型接口返回了无法识别的数据", {
        code: "INVALID_RESPONSE",
        status: response.status,
      });
    }

    if (!response.ok) {
      const upstreamMessage = data?.error?.message || data?.message || "模型接口请求失败";
      const friendlyMessage = response.status === 401 || response.status === 403
        ? "API Key 无效或没有模型权限"
        : response.status === 429
          ? "请求太频繁或额度不足，请稍后再试"
          : `模型接口请求失败（${response.status}）`;
      throw new OpenAIServiceError(friendlyMessage, {
        code: "UPSTREAM_ERROR",
        status: response.status,
        details: upstreamMessage,
      });
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new OpenAIServiceError("模型没有返回有效文字", {
        code: "EMPTY_RESPONSE",
        status: response.status,
      });
    }

    return {
      content: content.trim(),
      id: data.id || null,
      model: data.model || model,
      usage: data.usage || null,
      raw: data,
    };
  }
}
