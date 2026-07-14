const VALID_ROLES = new Set(["system", "user", "assistant"]);

export class ConversationManager {
  constructor({ contextLimit = 20, tokenLimit = 0, tokenTruncator = null } = {}) {
    this.contextLimit = this.normalizeContextLimit(contextLimit);
    this.tokenLimit = Math.max(0, Number(tokenLimit) || 0);
    this.tokenTruncator = tokenTruncator;
  }

  normalizeContextLimit(value) {
    return Math.min(100, Math.max(2, Number(value) || 20));
  }

  normalizeMessage(message) {
    if (!message || !VALID_ROLES.has(message.role)) return null;
    const content = String(message.content || "").trim();
    if (!content || message.status === "error") return null;
    return { role: message.role, content };
  }

  build({ messages = [], systemPrompt = "" } = {}) {
    const history = messages
      .map((message) => this.normalizeMessage(message))
      .filter(Boolean)
      .filter((message) => message.role !== "system")
      .slice(-this.contextLimit);

    const result = [];
    if (String(systemPrompt).trim()) {
      result.push({ role: "system", content: String(systemPrompt).trim() });
    }
    result.push(...history);
    return this.truncateByToken(result, this.tokenLimit);
  }

  estimateTokens(messages) {
    return messages.reduce((total, message) => {
      const text = String(message.content || "");
      const chineseCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
      const otherCount = text.length - chineseCount;
      return total + chineseCount + Math.ceil(otherCount / 4) + 4;
    }, 0);
  }

  truncateByToken(messages, tokenLimit = this.tokenLimit) {
    if (!tokenLimit) return messages;
    if (typeof this.tokenTruncator === "function") {
      return this.tokenTruncator(messages, tokenLimit);
    }

    const system = messages[0]?.role === "system" ? messages[0] : null;
    const history = system ? messages.slice(1) : [...messages];
    while (history.length > 1 && this.estimateTokens(system ? [system, ...history] : history) > tokenLimit) {
      history.shift();
    }
    return system ? [system, ...history] : history;
  }

  setTokenTruncator(tokenTruncator) {
    this.tokenTruncator = tokenTruncator;
  }
}
