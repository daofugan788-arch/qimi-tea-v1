const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));

function contains(text, words) {
  return words.some((word) => text.includes(word));
}

function profitScore(rate) {
  if (rate >= 50) return 100;
  if (rate >= 40) return 90;
  if (rate >= 30) return 80;
  if (rate >= 20) return 65;
  if (rate >= 10) return 45;
  if (rate > 0) return 25;
  return 0;
}

function recommendation(total, hasLoss) {
  if (hasLoss) return { level: "D", label: "不建议销售", tone: "danger" };
  if (total >= 80) return { level: "A", label: "适合测试销售", tone: "good" };
  if (total >= 65) return { level: "B", label: "建议小批量测试", tone: "good" };
  if (total >= 50) return { level: "C", label: "谨慎观察", tone: "watch" };
  return { level: "D", label: "暂不建议测试", tone: "danger" };
}

export const productScoreTool = {
  name: "product.score",
  description: "按利润、需求、竞争、售后和运输五个维度计算商品评分",
  riskLevel: "LOW",
  async execute(_input, context) {
    const product = context.outputs["product.normalize"];
    const profit = context.outputs["profit.calculate"];
    if (!product || !profit) throw new Error("商品评分缺少利润数据");
    const text = `${product.name} ${product.note}`.toLowerCase();

    let demand = 65;
    if (contains(text, ["夏季", "风扇", "防晒", "驱蚊", "雨季", "开学"])) demand += 10;
    if (contains(text, ["需求高", "热卖", "刚需"])) demand += 12;
    if (contains(text, ["冷门", "需求低", "过季"])) demand -= 20;

    let competition = 62;
    if (contains(text, ["手机壳", "数据线", "风扇", "纸巾", "同款多", "竞争大"])) competition -= 17;
    if (contains(text, ["竞争小", "差异化", "独家", "定制"])) competition += 18;

    let afterSales = 78;
    if (contains(text, ["电器", "电子", "风扇", "充电", "易碎", "玻璃", "尺码", "质量不稳定"])) afterSales -= 22;
    if (contains(text, ["无售后", "不易坏", "耗材", "标准品"])) afterSales += 10;

    const shippingRatio = profit.salePrice > 0 ? (profit.shipping / profit.salePrice) * 100 : 100;
    let transport = shippingRatio <= 10 ? 90 : shippingRatio <= 20 ? 75 : shippingRatio <= 30 ? 55 : 30;
    if (contains(text, ["大件", "重", "易碎", "液体"])) transport -= 20;
    if (contains(text, ["轻", "小件", "便携"])) transport += 8;

    const dimensions = {
      profit: clamp(profitScore(profit.profitRate)),
      demand: clamp(demand),
      competition: clamp(competition),
      afterSales: clamp(afterSales),
      transport: clamp(transport),
    };
    const total = Math.round(
      dimensions.profit * 0.30
      + dimensions.demand * 0.25
      + dimensions.competition * 0.20
      + dimensions.afterSales * 0.15
      + dimensions.transport * 0.10,
    );
    const risks = [];
    if (profit.netProfit <= 0) risks.push("扣除成本后会亏损，不建议按当前价格销售");
    if (profit.profitRate < 30) risks.push("利润率低于 30%，降价空间和售后缓冲不足");
    if (shippingRatio > 20) risks.push("运费占售价比例较高，利润容易被物流波动吃掉");
    if (afterSales < 65) risks.push("商品存在质量或退换货风险，测试前应确认供应商售后");
    if (competition < 55) risks.push("同类商品竞争可能较强，需要差异化标题、组合或服务");
    if (risks.length === 0) risks.push("暂未发现明显成本风险，仍需用真实市场数据验证需求");

    return {
      total,
      dimensions,
      weights: { profit: 30, demand: 25, competition: 20, afterSales: 15, transport: 10 },
      recommendation: recommendation(total, profit.netProfit <= 0),
      risks,
      dataBasis: "利润使用输入数据；需求、竞争、售后与运输为规则初评，尚未接入实时市场数据。",
    };
  },
};
