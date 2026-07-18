function decision(product, rank) {
  if (product.profit <= 0) return "淘汰：当前价格下没有销售利润";
  if (product.score < 50) return "暂缓：综合评分低于 50 分";
  if (product.profitRate < 20) return "暂缓：利润率不足 20%";
  if (rank === 1) return "优先测试：综合评分和利润表现领先";
  if (rank <= 3) return "备选测试：控制数量，观察真实咨询与成交";
  return "后备观察：先验证排名更高的商品";
}

export const productCompareTool = {
  name: "product.compare",
  description: "根据商品评分、利润率和单件利润生成选品排名",
  riskLevel: "LOW",
  async execute(_input, context) {
    const products = context.outputs["selection.prepare"];
    const ranked = [...products].sort((a, b) => (
      b.score - a.score
      || b.profitRate - a.profitRate
      || b.profit - a.profit
    ));
    const rankings = ranked.map((product, index) => ({
      rank: index + 1,
      ...product,
      decision: decision(product, index + 1),
    }));
    const viable = rankings.filter((product) => product.profit > 0 && product.score >= 50 && product.profitRate >= 20);
    return {
      rankings,
      winner: viable[0] || null,
      viableCount: viable.length,
      rejectedCount: rankings.length - viable.length,
    };
  },
};
