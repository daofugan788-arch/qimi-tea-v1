import { TOOL_RISK, TOOL_TYPE } from "../../tools/tool-types.js";

function fallbackMaterial(product, channel) {
  const shortName = String(product.name || "商品").replace(/\s+/g, " ").trim();
  const salePrice = product.market_price;
  return {
    opportunityId: product.id,
    productName: shortName,
    channel,
    title: `${shortName}｜个人闲置风格发布｜下单前确认细节`.slice(0, 60),
    description: [
      `${shortName}，公开商品资料整理，适合先做小规模测试。`,
      `参考售价：${product.currency || ""} ${salePrice}，具体价格可根据实际运费和平台费用调整。`,
      `商品特点：${product.product_type || "小件商品"}，详情以来源页面和实际收到的商品为准。`,
      "下单前请先确认库存、规格和发货时间；不夸大功能，不承诺来源页面未公开的信息。",
    ].join("\n"),
    sellingPoints: [
      "价格信息和来源链接可追溯",
      "先小量测试，降低压货风险",
      "商品详情以真实图片与实际规格为准",
    ],
    imageAdvice: [
      "首图使用商品正面清晰图，避免水印和夸张文字",
      "补充尺寸或使用场景图，并标注图片来源",
      "发布前拍摄实物图，确认颜色、规格与包装状态",
    ],
    customerService: {
      price: `目前参考价是 ${product.currency || ""} ${salePrice}，如果诚心要可以聊一下。`,
      discount: "可以小幅商量，但需要先确认运费和规格，合适的话我给你算实价。",
      shipping: "下单前我先确认库存和发货时间，确认后再回复你准确日期。",
      stock: "我先核对一下库存和规格，确认有货后马上回复你。",
    },
    generatedBy: "SAFE_TEMPLATE",
  };
}

export class ContentGenerationTool {
  constructor(client = null) {
    this.name = "commerce.content.generate";
    this.type = TOOL_TYPE.LLM;
    this.riskLevel = TOOL_RISK.LOW;
    this.description = "为推荐商品生成可复制标题、描述、卖点、图片建议和客服话术";
    this.client = client;
  }

  async execute(input = {}) {
    const candidates = (input.evaluated || [])
      .filter((item) => item.decision === "TEST")
      .sort((a, b) => b.score - a.score || b.profit - a.profit)
      .slice(0, Number(input.desiredCount) || 3);
    const items = [];
    for (const product of candidates) {
      if (this.client?.generate) {
        try {
          const generated = await this.client.generate({ product, channel: input.channel });
          items.push({ ...generated, opportunityId: product.id, productName: product.name, generatedBy: "LLM" });
          continue;
        } catch {
          // AI 接口失败时仍交付可复制的安全资料，并明确标记生成方式。
        }
      }
      items.push(fallbackMaterial(product, input.channel));
    }
    return { items, generatedAt: new Date().toISOString() };
  }
}
