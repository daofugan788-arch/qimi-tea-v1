// Hammer AI V0.8 配置。
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

// 付费验证阶段使用收款码 + 人工确认，不接复杂支付或账号系统。
// paymentQrUrl 留空时自动进入安全测试模式，不会发生真实扣款。
export const PAYMENT_CONFIG = Object.freeze({
  enabled: true,
  freeGenerations: 1,
  planName: "商家内测版",
  price: "19.9",
  billingCycle: "月",
  paymentQrUrl: "",
  paymentMethodLabel: "微信收款码",
  confirmationMode: "manual",
});

export function hasRemoteAIConfig(config = AI_CONFIG) {
  return Boolean(
    String(config.apiUrl || "").trim()
    && String(config.apiKey || "").trim()
    && String(config.model || "").trim(),
  );
}
