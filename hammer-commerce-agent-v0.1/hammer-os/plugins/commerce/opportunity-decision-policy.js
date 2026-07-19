const round = (value) => Math.round(Number(value || 0) * 100) / 100;

function isPublic(value) {
  return Boolean(String(value || "").trim() && !/未公开|未知|暂无|not available/i.test(String(value)));
}

function matchingOutcomes(name, outcomes) {
  const key = String(name || "").toLowerCase();
  return (outcomes || []).filter((item) => {
    const candidate = String(item.productName || item.name || "").toLowerCase();
    return candidate && (key.includes(candidate) || candidate.includes(key));
  });
}

export async function evaluateOpportunity(input = {}) {
  const opportunity = input.opportunity || {};
  const outcomes = matchingOutcomes(opportunity.name, input.outcomes);
  const successes = outcomes.filter((item) => item.outcome === "SOLD" && Number(item.profit) > 0).length;
  const failures = outcomes.filter((item) => ["NO_SALE", "RETURNED", "LOSS"].includes(item.outcome)).length;
  const learningAdjustment = Math.max(-15, Math.min(15, successes * 5 - failures * 5));
  const demandPublished = isPublic(opportunity.sales_signal) || isPublic(opportunity.review_signal);
  const evidenceComplete = Boolean(opportunity.source_url && (opportunity.screenshot || opportunity.image) && opportunity.timestamp);
  const rating = Number(String(opportunity.rating_signal || "").match(/\d+(?:\.\d+)?/)?.[0]);
  const profitPass = opportunity.profit >= opportunity.minimum_profit;
  const marginPass = opportunity.profit_rate >= 20;
  const qualityPass = !Number.isFinite(rating) || rating >= 3;

  let score = 0;
  score += profitPass ? 40 : Math.max(0, Math.min(35, opportunity.profit * 2));
  score += marginPass ? 20 : Math.max(0, opportunity.profit_rate / 2);
  score += evidenceComplete ? 20 : opportunity.source_url ? 8 : 0;
  score += demandPublished ? 10 : 0;
  score += qualityPass ? 5 : 0;
  score += 5 + learningAdjustment;
  score = Math.max(0, Math.min(100, Math.round(score)));

  let decision = "WATCH";
  if (opportunity.profit <= 0 || opportunity.profit_rate < 12 || !qualityPass) decision = "REJECT";
  else if (profitPass && marginPass && evidenceComplete && score >= 65) decision = "TEST";

  const risk = decision === "REJECT"
    ? "高"
    : demandPublished && opportunity.profit_rate >= 30 && qualityPass ? "低" : "中";
  const reasons = [
    `预计利润 ${round(opportunity.profit)}，利润率 ${round(opportunity.profit_rate)}%`,
    evidenceComplete ? "来源、抓取时间和公开图片/截图证据完整" : "公开来源证据不完整",
    demandPublished ? "页面存在公开需求信号" : "页面未公开销量或评价数量",
    `竞争：${opportunity.competition || "未知"}`,
    `售后风险：${opportunity.after_sales_risk || "未知"}`,
  ];
  if (outcomes.length) reasons.push(`长期记忆：同类 ${successes} 次正向、${failures} 次失败，权重 ${learningAdjustment >= 0 ? "+" : ""}${learningAdjustment}`);

  return {
    score,
    decision,
    risk,
    reason: reasons.join("；"),
    reasons,
    learning: { samples: outcomes.length, successes, failures, adjustment: learningAdjustment },
    decidedAt: new Date().toISOString(),
  };
}
