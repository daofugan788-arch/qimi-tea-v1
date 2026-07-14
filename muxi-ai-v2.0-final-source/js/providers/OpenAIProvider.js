import { OpenAIService } from "../api/OpenAIService.js";

export class AIProvider {
  async chat() {
    throw new Error("Provider.chat() 尚未实现");
  }

  async testConnection() {
    throw new Error("Provider.testConnection() 尚未实现");
  }
}

export class OpenAIProvider extends AIProvider {
  constructor(config = {}, dependencies = {}) {
    super();
    this.config = {
      baseURL: String(config.baseURL || "").trim(),
      apiKey: String(config.apiKey || "").trim(),
      model: String(config.model || "").trim(),
      temperature: Number(config.temperature ?? 0.8),
      maxTokens: Number(config.maxTokens ?? 1024),
      stream: Boolean(config.stream),
    };
    this.service = new OpenAIService({
      baseURL: this.config.baseURL,
      apiKey: this.config.apiKey,
      fetchImpl: dependencies.fetchImpl || globalThis.fetch,
    });
  }

  async chat({ messages, signal, temperature, maxTokens, stream } = {}) {
    const result = await this.service.createChatCompletion({
      model: this.config.model,
      messages,
      temperature: temperature ?? this.config.temperature,
      maxTokens: maxTokens ?? this.config.maxTokens,
      stream: stream ?? this.config.stream,
      signal,
    });
    return result.content;
  }

  async testConnection({ signal } = {}) {
    return this.chat({
      messages: [
        { role: "system", content: "这是连接测试。" },
        { role: "user", content: "只回复 OK" },
      ],
      temperature: 0,
      maxTokens: 8,
      stream: false,
      signal,
    });
  }
}
