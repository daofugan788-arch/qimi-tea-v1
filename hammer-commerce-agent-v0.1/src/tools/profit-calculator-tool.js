const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function nextPsychologicalPrice(value) {
  return round(Math.ceil(value) + 0.9);
}

export class ProfitCalculatorTool {
  constructor() {
    this.name = "profit.calculate";
    this.description = "计算商品毛利润、销售利润、利润率和最低成交价";
    this.riskLevel = "LOW";
  }

  async execute(_input, context) {
    const product = context.outputs["product.normalize"];
    if (!product) throw new Error("缺少标准化商品数据");
    const grossProfit = round(product.price - product.cost - product.shipping);
    const netProfit = round(grossProfit - product.platformFee);
    const totalCost = round(product.cost + product.shipping + product.platformFee);
    const profitRate = round((netProfit / product.price) * 100);
    const targetPrice = nextPsychologicalPrice(totalCost / 0.7);
    return {
      purchaseCost: product.cost,
      shipping: product.shipping,
      platformFee: product.platformFee,
      totalCost,
      salePrice: product.price,
      grossProfit,
      netProfit,
      profitRate,
      minimumDealPrice: totalCost,
      recommendedPrice: product.price >= targetPrice ? product.price : targetPrice,
      targetMargin: 30,
    };
  }
}
