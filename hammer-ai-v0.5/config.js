// Hammer AI V0.5 配置。
// 静态演示默认使用本地生成器，打开网页即可体验，不会上传商品资料。
// 正式接入模型时请通过服务端代理保护 API Key，不要把真实密钥提交到公开仓库。
export const AI_CONFIG = Object.freeze({
  apiUrl: "",
  apiKey: "",
  model: "",
  temperature: 0.7,
  maxTokens: 1200,
  timeoutMs: 30000,
});

export function hasRemoteAIConfig(config = AI_CONFIG) {
  return Boolean(
    String(config.apiUrl || "").trim()
    && String(config.apiKey || "").trim()
    && String(config.model || "").trim(),
  );
}
