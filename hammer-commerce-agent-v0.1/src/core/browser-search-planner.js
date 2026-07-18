function readNumber(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function readKeywords(text) {
  const cleaned = text
    .replace(/(?:帮我|今天|请|想要)/g, " ")
    .replace(/(?:寻找|搜索|找|发现|筛选)/g, " ")
    .replace(/(?:前|最多)\s*\d+\s*个/g, " ")
    .replace(/利润(?:率)?\s*\d+(?:\.\d+)?\s*(?:元|%)?\s*(?:以上|以内|以下)?/g, " ")
    .replace(/\d+(?:\.\d+)?\s*元?\s*(?:以内|以下|以上|左右)/g, " ")
    .replace(/(?:适合|可以|能够)?\s*(?:个人)?\s*(?:卖|销售|测试)的?/g, " ")
    .replace(/^的|的$/g, " ")
    .replace(/[，,。；;：:\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:的\s*)+|(?:\s*的)+$/g, "")
    .trim();
  return cleaned || "热门小商品";
}

export class BrowserSearchPlanner {
  createPlan(goal) {
    const text = String(goal || "").trim();
    if (!text) throw new Error("Browser Agent 缺少搜索目标");
    const maxSourcePrice = readNumber(text, [
      /(\d+(?:\.\d+)?)\s*元?\s*(?:以内|以下)/,
      /(?:成本|价格|采购价|预算)\s*(?:不超过|低于|小于)?\s*(\d+(?:\.\d+)?)/,
    ]);
    const minProfit = readNumber(text, [
      /利润\s*(\d+(?:\.\d+)?)\s*元?\s*(?:以上|起)?/,
      /至少赚\s*(\d+(?:\.\d+)?)/,
    ]);
    const requestedLimit = readNumber(text, [/(?:前|最多)\s*(\d+)\s*个/]);
    const query = readKeywords(text);
    return {
      goal: text,
      query,
      constraints: {
        maxSourcePrice,
        minProfit,
        limit: Math.min(20, Math.max(1, requestedLimit || 8)),
      },
      tasks: [
        { id: "BROWSER-1", title: `搜索公开页面：${query}` },
        { id: "BROWSER-2", title: maxSourcePrice === null ? "读取公开商品价格" : `筛选采购价不高于 ¥${maxSourcePrice}` },
        { id: "BROWSER-3", title: minProfit === null ? "计算预计利润" : `筛选预计利润不低于 ¥${minProfit}` },
        { id: "BROWSER-4", title: "保存截图和商品证据" },
        { id: "BROWSER-5", title: "生成《今日选品报告》" },
      ],
    };
  }
}

export function shouldRunBrowserSearch(goal, { hasProducts = false } = {}) {
  const text = String(goal || "");
  if (/商品库|已有候选|现有商品/.test(text)) return false;
  return !hasProducts || /寻找|搜索|找货|找.{0,12}商品|发现|选品/.test(text);
}
