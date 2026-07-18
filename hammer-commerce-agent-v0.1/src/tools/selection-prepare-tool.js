export const selectionPrepareTool = {
  name: "selection.prepare",
  description: "校验并整理需要对比的候选商品",
  riskLevel: "LOW",
  async execute({ products }) {
    if (!Array.isArray(products) || products.length < 2) throw new Error("至少需要 2 个候选商品");
    return products.map((product) => ({
      id: product.id,
      name: String(product.name || "未命名商品"),
      cost: Number(product.cost) || 0,
      price: Number(product.price) || 0,
      profit: Number(product.profit) || 0,
      profitRate: Number(product.profitRate) || 0,
      score: Number(product.score) || 0,
      recommendation: product.recommendation || "待判断",
      note: product.note || "",
    }));
  },
};
