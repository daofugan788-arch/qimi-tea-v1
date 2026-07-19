export const PRODUCT_DECISION = Object.freeze({
  TEST: "TEST",
  WATCH: "WATCH",
  REJECT: "REJECT",
});

const round = (value) => Math.round(Number(value || 0) * 100) / 100;

function isPublic(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/未公开|未知|暂无|not available/i.test(text));
}

function publicNumber(value) {
  const match = String(value || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function label(decision) {
  if (decision === PRODUCT_DECISION.TEST) return "值得小规模测试";
  if (decision === PRODUCT_DECISION.WATCH) return "继续观察补证据";
  return "放弃当前候选";
}

export function judgeProduct(product = {}, plan = {}) {
  const profit = round(product.profit);
  const profitRate = round(product.profitRate);
  const minimumProfit = plan?.constraints?.minProfit === null || plan?.constraints?.minProfit === undefined
    ? 10
    : Math.max(0, Number(plan.constraints.minProfit) || 0);
  const rating = publicNumber(product.ratingText);
  const salesPublished = isPublic(product.salesText);
  const reviewsPublished = isPublic(product.reviewText);
  const demandPublished = salesPublished || reviewsPublished;
  const sourceComplete = Boolean(product.sourceUrl && product.screenshotUrl && product.capturedAt && Number(product.cost) > 0);
  const profitPass = profit > 0 && profit >= minimumProfit;
  const marginPass = profitRate >= 20;
  const qualityFailure = rating !== null && rating < 3;

  let decision = PRODUCT_DECISION.WATCH;
  if (profit <= 0 || profitRate < 15 || qualityFailure) decision = PRODUCT_DECISION.REJECT;
  else if (profitPass && marginPass && sourceComplete && demandPublished) decision = PRODUCT_DECISION.TEST;

  const reasons = [];
  if (profitPass) reasons.push(`预计利润 ¥${profit}，达到目标 ¥${minimumProfit}`);
  else if (profit > 0) reasons.push(`预计利润 ¥${profit}，尚未达到目标 ¥${minimumProfit}`);
  else reasons.push("当前公开价格样本没有形成正利润空间");
  if (marginPass) reasons.push(`预计利润率 ${profitRate}%，具备基础缓冲`);
  else reasons.push(`预计利润率 ${profitRate}%，降价和售后缓冲不足`);
  if (demandPublished) reasons.push(salesPublished ? `来源公开销量：${product.salesText}` : `来源公开评价：${product.reviewText}`);
  else reasons.push("来源没有公开销量或评价数量，需求证据不足");
  if (rating !== null) reasons.push(`公开评分 ${rating}`);

  const risks = ["市场参考价来自抓取时的公开样本，不等于最终成交价"];
  if (!sourceComplete) risks.push("来源、抓取时间或截图证据不完整");
  if (!salesPublished) risks.push("来源未公开销量，测试前仍需验证真实需求");
  if (rating !== null && rating <= 3) risks.push("公开评分偏低，需检查质量与售后问题");
  if (profitRate < 30) risks.push("利润率低于30%，实际运费或退货可能吃掉利润");

  const confidence = Math.min(100,
    (product.sourceUrl ? 20 : 0)
    + (product.screenshotUrl ? 20 : 0)
    + (product.capturedAt ? 10 : 0)
    + (Number(product.cost) > 0 ? 15 : 0)
    + (demandPublished ? 20 : 0)
    + (rating !== null ? 15 : 0));

  return {
    decision,
    label: label(decision),
    confidence,
    reasons,
    risks,
    gates: {
      profit: profitPass,
      margin: marginPass,
      evidence: sourceComplete,
      demand: demandPublished,
      quality: !qualityFailure,
    },
    nextAction: decision === PRODUCT_DECISION.TEST
      ? "进入商品资料生成，只准备小规模测试，不自动发布。"
      : decision === PRODUCT_DECISION.WATCH
        ? "继续搜索同类来源，补充销量、评价或更可靠的成交价证据。"
        : "停止为该候选生成发布资料，自动尝试下一个商品。",
    judgedAt: new Date().toISOString(),
  };
}

export function judgeProducts(products = [], plan = {}) {
  return products
    .map((product) => ({ product, judgment: judgeProduct(product, plan) }))
    .sort((a, b) => {
      const priority = { TEST: 3, WATCH: 2, REJECT: 1 };
      return priority[b.judgment.decision] - priority[a.judgment.decision]
        || b.judgment.confidence - a.judgment.confidence
        || b.product.profit - a.product.profit;
    });
}
