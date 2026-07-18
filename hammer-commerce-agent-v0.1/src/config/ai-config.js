export const AI_CONFIG_STORAGE_KEY = "hammer-commerce-agent-v0.1-ai-config";

export const DEFAULT_AI_CONFIG = Object.freeze({
  baseUrl: "",
  apiKey: "",
  model: "",
});

export function loadAIConfig(storage = globalThis.localStorage) {
  try {
    return {
      ...DEFAULT_AI_CONFIG,
      ...JSON.parse(storage?.getItem(AI_CONFIG_STORAGE_KEY) || "{}"),
    };
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

export function saveAIConfig(config, storage = globalThis.localStorage) {
  const next = {
    baseUrl: String(config?.baseUrl || "").trim(),
    apiKey: String(config?.apiKey || "").trim(),
    model: String(config?.model || "").trim(),
  };
  storage?.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(next));
  return next;
}
