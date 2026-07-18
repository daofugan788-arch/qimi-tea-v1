function money(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label}必须是大于或等于 0 的数字`);
  return Math.round(number * 100) / 100;
}

export const productNormalizeTool = {
  name: "product.normalize",
  description: "校验并标准化商品成本信息",
  riskLevel: "LOW",
  async execute({ product }) {
    if (!product?.name?.trim()) throw new Error("请输入商品名称");
    const normalized = {
      name: product.name.trim().slice(0, 80),
      cost: money(product.cost, "采购价格"),
      price: money(product.price, "销售价格"),
      shipping: money(product.shipping, "运费"),
      platformFee: money(product.platformFee, "平台费用"),
      note: String(product.note || "").trim().slice(0, 300),
    };
    if (normalized.price <= 0) throw new Error("销售价格必须大于 0");
    return normalized;
  },
};
