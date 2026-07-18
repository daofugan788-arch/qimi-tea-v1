function includesAny(text, words) {
  return words.find((word) => text.includes(word)) || "";
}

export const goalAnalyzeTool = {
  name: "goal.analyze",
  description: "识别用户的电商目标、平台和关键约束",
  riskLevel: "LOW",
  async execute({ goal }) {
    const text = String(goal || "").trim();
    const marginMatch = text.match(/(?:利润率|毛利率|利润)[^0-9]{0,5}(\d{1,3})\s*%?/);
    const platform = includesAny(text, ["闲鱼", "抖音", "淘宝", "拼多多", "小红书", "微信"]);
    const category = includesAny(text, ["小商品", "女鞋", "服装", "食品", "数码", "家居", "饰品", "玩具"]);
    const intent = includesAny(text, ["找", "寻找", "选品", "推荐"]) ? "PRODUCT_DISCOVERY" : "COMMERCE_ASSIST";
    return {
      intent,
      platform: platform || "待确认",
      category: category || "不限类目",
      targetMargin: marginMatch ? Number(marginMatch[1]) : 30,
      originalGoal: text,
    };
  },
};
