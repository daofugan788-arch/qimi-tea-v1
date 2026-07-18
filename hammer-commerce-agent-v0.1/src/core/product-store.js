export const PRODUCT_STORAGE_KEY = "hammer-commerce-agent-v0.2-products";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function productId() {
  return `PRD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

export class ProductStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
  }

  list() {
    try {
      const products = JSON.parse(this.storage?.getItem(PRODUCT_STORAGE_KEY) || "[]");
      return Array.isArray(products) ? products : [];
    } catch {
      return [];
    }
  }

  getByIds(ids = []) {
    const selected = new Set(ids);
    return this.list().filter((product) => selected.has(product.id));
  }

  saveAnalysis(product, report) {
    const now = new Date().toISOString();
    const record = {
      id: productId(),
      name: String(product.name || "").trim(),
      cost: Number(product.cost) || 0,
      price: Number(product.price) || 0,
      shipping: Number(product.shipping) || 0,
      platformFee: Number(product.platformFee) || 0,
      note: String(product.note || "").trim(),
      profit: Number(report?.profit?.net) || 0,
      profitRate: Number(report?.profit?.rate) || 0,
      score: Number(report?.score?.total) || 0,
      recommendation: report?.recommendation?.label || "待判断",
      created_time: now,
    };
    const products = this.list();
    products.unshift(record);
    this.storage?.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(products.slice(0, 100)));
    return clone(record);
  }

  saveDiscovery(item) {
    const products = this.list();
    const sourceUrl = String(item?.sourceUrl || "").trim();
    const existing = sourceUrl ? products.find((product) => product.sourceUrl === sourceUrl) : null;
    if (existing) return clone(existing);
    const cost = Number(item?.price) || 0;
    const marketReference = Math.max(cost, Number(item?.marketReference) || cost);
    const shipping = Math.max(0, Number(item?.estimatedShipping) || 0);
    const profit = Math.round((marketReference - cost - shipping) * 100) / 100;
    const record = {
      id: productId(),
      name: String(item?.name || "").trim(),
      cost,
      price: marketReference,
      shipping,
      platformFee: 0,
      note: `Browser Agent 公开页面候选；来源：${item?.source || "未知"}`,
      profit,
      profitRate: marketReference > 0 ? Math.round((profit / marketReference) * 10000) / 100 : 0,
      score: profit > 0 ? 70 : 40,
      recommendation: profit > 0 ? "待测试" : "暂不建议",
      source: String(item?.source || "").trim(),
      sourceUrl,
      salesText: String(item?.salesText || "未公开"),
      ratingText: String(item?.ratingText || "未公开"),
      imageUrl: String(item?.imageUrl || ""),
      screenshotUrl: String(item?.screenshotUrl || ""),
      reason: String(item?.reason || ""),
      evidenceSessionId: item?.evidenceSessionId || null,
      capturedAt: item?.capturedAt || new Date().toISOString(),
      created_time: new Date().toISOString(),
    };
    products.unshift(record);
    this.storage?.setItem(PRODUCT_STORAGE_KEY, JSON.stringify(products.slice(0, 100)));
    return clone(record);
  }

  clear() {
    this.storage?.removeItem(PRODUCT_STORAGE_KEY);
  }
}
