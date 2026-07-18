export const EVIDENCE_STORAGE_KEY = "hammer-commerce-agent-v1.0-browser-evidence";

const clone = (value) => JSON.parse(JSON.stringify(value));

export class EvidenceStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
  }

  list() {
    try {
      const sessions = JSON.parse(this.storage?.getItem(EVIDENCE_STORAGE_KEY) || "[]");
      return Array.isArray(sessions) ? sessions : [];
    } catch {
      return [];
    }
  }

  save({ goal, plan, items, sourceRunId }) {
    const now = new Date().toISOString();
    const session = {
      id: `EVD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
      sourceRunId: sourceRunId || null,
      goal,
      query: plan?.query || "",
      constraints: plan?.constraints || {},
      capturedAt: now,
      items: clone(items || []).map((item) => ({
        id: item.id,
        name: item.name,
        source: item.source,
        sourceUrl: item.sourceUrl,
        price: item.price,
        salesText: item.salesText || "未公开",
        ratingText: item.ratingText || "未公开",
        imageUrl: item.imageUrl || "",
        screenshotUrl: item.screenshotUrl || "",
        capturedAt: item.capturedAt || now,
      })),
    };
    const sessions = this.list();
    sessions.unshift(session);
    this.storage?.setItem(EVIDENCE_STORAGE_KEY, JSON.stringify(sessions.slice(0, 30)));
    return clone(session);
  }

  clear() {
    this.storage?.removeItem(EVIDENCE_STORAGE_KEY);
  }
}
