export const SALES_STORAGE_KEY = "hammer-commerce-agent-v0.4-sales";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function localDay(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class SalesStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
  }

  list() {
    try {
      const records = JSON.parse(this.storage?.getItem(SALES_STORAGE_KEY) || "[]");
      return Array.isArray(records) ? records : [];
    } catch {
      return [];
    }
  }

  record(input) {
    const quantity = Math.max(0, Number(input.quantity) || 0);
    const salePrice = Number(input.salePrice) || 0;
    const unitCost = Number(input.unitCost) || 0;
    const now = new Date();
    const record = {
      id: `SALE-${Date.now().toString(36).toUpperCase()}`,
      chainId: input.chainId,
      productId: input.productId,
      productName: input.productName,
      quantity,
      salePrice,
      unitCost,
      revenue: Math.round(salePrice * quantity * 100) / 100,
      profit: Math.round((salePrice - unitCost) * quantity * 100) / 100,
      day: localDay(now),
      createdAt: now.toISOString(),
    };
    const records = this.list();
    records.unshift(record);
    this.storage?.setItem(SALES_STORAGE_KEY, JSON.stringify(records.slice(0, 500)));
    return clone(record);
  }

  today() {
    const day = localDay();
    return this.list().filter((record) => record.day === day);
  }
}
