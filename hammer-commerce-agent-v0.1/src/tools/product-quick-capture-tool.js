const NUMBER = "(-?\\d+(?:\\.\\d+)?)";

function readAmount(text, labels) {
  const match = text.match(new RegExp(`(?:${labels.join("|")})\\s*(?:[:：=]|是|为)?\\s*[¥￥]?\\s*${NUMBER}`, "i"));
  return match ? Number(match[1]) : null;
}

function readName(text) {
  const stop = "成本|采购价格|采购价|进价|销售价格|销售价|售价|卖价|运费|快递费|平台费用|平台费|备注";
  const labelled = text.match(new RegExp(`(?:商品名称|商品|品名)\\s*(?:[:：=]|是|为)?\\s*(.+?)(?=\\s*(?:${stop})|[，,；;\\n]|$)`, "i"));
  const prefix = labelled?.[1] || text.split(new RegExp(`\\s*(?:${stop})`, "i"))[0];
  return String(prefix || "")
    .replace(/^(?:帮我)?(?:分析|添加|录入|看看|这个商品是)\s*/i, "")
    .replace(/^(?:商品名称|商品|品名)\s*(?:[:：=]|是|为)?\s*/i, "")
    .replace(/^[，,；;：:\s]+|[，,；;：:\s]+$/g, "")
    .trim();
}

function readNote(text) {
  return String(text.match(/备注\s*(?:[:：=]|是|为)?\s*(.+)$/i)?.[1] || "").trim();
}

export function parseQuickProductText(value) {
  const text = String(value || "").replace(/\r/g, "").trim();
  if (!text) throw new Error("粘贴一句商品信息后，Agent 才能继续。");

  const product = {
    name: readName(text),
    cost: readAmount(text, ["采购价格", "采购价", "成本", "进价"]),
    price: readAmount(text, ["销售价格", "销售价", "售价", "卖价"]),
    shipping: readAmount(text, ["运费", "快递费"]),
    platformFee: readAmount(text, ["平台费用", "平台费"]),
    note: readNote(text),
  };

  if (!product.name) throw new Error("没有识别到商品名称，例如：桌面风扇 成本15 售价39.9 运费5。");
  if (product.cost === null || product.price === null) throw new Error("请在一句话里写明成本和售价。");
  if (product.cost < 0 || product.price <= 0) throw new Error("成本不能小于 0，售价必须大于 0。");
  product.shipping = Math.max(0, product.shipping ?? 0);
  product.platformFee = Math.max(0, product.platformFee ?? 0);
  return product;
}

export const productQuickCaptureTool = {
  name: "product.quick.capture",
  description: "从一句商品信息中提取名称、成本、售价、运费和平台费用",
  riskLevel: "LOW",
  async execute(input) {
    return parseQuickProductText(input?.text);
  },
};
