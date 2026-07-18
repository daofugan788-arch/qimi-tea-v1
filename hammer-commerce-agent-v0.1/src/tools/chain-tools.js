import { TOOL_OUTCOME } from "../core/chain-status.js";

const success = (data) => ({ outcome: TOOL_OUTCOME.SUCCESS, data });
const blocked = (actionType, reason, data = null) => ({ outcome: TOOL_OUTCOME.BLOCKED, actionType, reason, data });

export class ChainProductDiscoveryTool {
  constructor(productStore) {
    this.name = "chain.product.discover";
    this.description = "从商品库发现尚未尝试的候选商品";
    this.riskLevel = "LOW";
    this.productStore = productStore;
  }

  async execute(_input, runtime) {
    const products = this.productStore.list();
    const attempted = new Set(runtime.chain.context.attemptedProductIds || []);
    const candidate = products
      .filter((product) => !attempted.has(product.id))
      .sort((a, b) => b.score - a.score || b.profitRate - a.profitRate)[0];
    if (!candidate) {
      return blocked(
        products.length ? "NO_VIABLE_PRODUCTS" : "NEED_PRODUCTS",
        products.length
          ? "商品库中的候选项已经全部尝试，暂时没有达到条件的商品。"
          : "商品库还没有候选商品。Browser Agent 尚未接入，当前无法自动搜索真实平台。",
        { attemptedCount: attempted.size },
      );
    }
    return success({ product: candidate });
  }
}

export const chainProfitScreenTool = {
  name: "chain.profit.screen",
  description: "检查候选商品利润，不达标时要求任务链继续寻找",
  riskLevel: "LOW",
  async execute(_input, runtime) {
    const product = runtime.chain.context.outputs["chain.product.discover"]?.product;
    if (!product) throw new Error("没有可分析的候选商品");
    const viable = product.profit > 0 && product.profitRate >= 20 && product.score >= 50;
    if (!viable) {
      const discoveryStep = runtime.chain.steps.findIndex((step) => step.tool === "chain.product.discover");
      return {
        outcome: TOOL_OUTCOME.RETRY,
        resetToStep: Math.max(0, discoveryStep),
        data: {
          product,
          reason: product.profit <= 0 ? "没有销售利润" : product.profitRate < 20 ? "利润率低于20%" : "商品评分低于50分",
        },
      };
    }
    return success({
      product,
      decision: "利润与基础评分达到测试门槛",
      minimumMargin: 20,
    });
  },
};

export const chainContentGenerateTool = {
  name: "chain.content.generate",
  description: "为选定商品生成个人卖家风格的发布资料",
  riskLevel: "LOW",
  async execute(_input, runtime) {
    const product = runtime.chain.context.outputs["chain.profit.screen"]?.product;
    if (!product) throw new Error("缺少通过利润筛选的商品");
    const title = `${product.name}｜个人闲置好物，实用省心可直接拍`;
    const description = `出一个${product.name}，自己认真对比后选的款。${product.note ? `特点：${product.note}。` : "日常使用方便，状态和细节会如实说明。"}\n\n参考价：¥${product.price}\n需要看细节可以直接问，确认清楚再拍。`;
    return success({
      product,
      title,
      description,
      customerReplies: {
        price: `现在是 ¥${product.price}，诚心要可以聊。`,
        stock: "目前可以安排，拍前我再帮你确认一次。",
        shipping: "确认后会尽快安排，具体发出时间以实际为准。",
      },
    });
  },
};

export const chainImagePrepareTool = {
  name: "chain.image.prepare",
  description: "为商品发布生成图片准备任务",
  riskLevel: "LOW",
  async execute(_input, runtime) {
    const content = runtime.chain.context.outputs["chain.content.generate"];
    if (!content) throw new Error("缺少商品发布资料");
    return success({
      product: content.product,
      shots: ["商品正面清晰图", "侧面或细节图", "尺寸或使用场景图", "瑕疵与真实状态图"],
      status: "图片任务清单已准备；图片识别与自动截图工具将在 Tool Agent 阶段接入。",
    });
  },
};

export const chainPublishPrepareTool = {
  name: "chain.publish.prepare",
  description: "整理发布内容并等待安全的发布确认",
  riskLevel: "MEDIUM",
  async execute(_input, runtime) {
    if (runtime.chain.context.signals?.published) {
      return success({ published: true, confirmedAt: new Date().toISOString() });
    }
    const content = runtime.chain.context.outputs["chain.content.generate"];
    return blocked(
      "CONFIRM_PUBLISH",
      "发布资料已经准备好。Browser Agent 尚未接入，当前需要主人手动发布后确认。",
      { title: content?.title, description: content?.description },
    );
  },
};

export const chainSaleWaitTool = {
  name: "chain.sale.wait",
  description: "等待成交结果并在收到信号后继续任务链",
  riskLevel: "LOW",
  async execute(_input, runtime) {
    const result = runtime.chain.context.signals?.saleResult;
    if (!result) return blocked("WAIT_SALE_RESULT", "任务已进入等待成交状态。收到成交结果后会自动继续计算利润。", null);
    return success({
      quantity: Math.max(0, Number(result.quantity) || 0),
      salePrice: Math.max(0, Number(result.salePrice) || 0),
    });
  },
};

export class ChainSaleRecordTool {
  constructor(salesStore) {
    this.name = "chain.sale.record";
    this.description = "记录成交收入和真实利润";
    this.riskLevel = "LOW";
    this.salesStore = salesStore;
  }

  async execute(_input, runtime) {
    const product = runtime.chain.context.outputs["chain.profit.screen"]?.product;
    const sale = runtime.chain.context.outputs["chain.sale.wait"];
    if (!product || !sale) throw new Error("记录利润所需的数据不完整");
    const record = this.salesStore.record({
      chainId: runtime.chain.id,
      productId: product.id,
      productName: product.name,
      quantity: sale.quantity,
      salePrice: sale.quantity > 0 ? sale.salePrice : product.price,
      unitCost: Number(product.cost) + Number(product.shipping) + Number(product.platformFee),
    });
    return success({ record });
  }
}

function targetFromGoal(goal) {
  const match = String(goal || "").match(/赚\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

export class ChainDailyReportTool {
  constructor(salesStore) {
    this.name = "chain.daily.report";
    this.description = "汇总今天的成交和利润并给主人报告";
    this.riskLevel = "LOW";
    this.salesStore = salesStore;
  }

  async execute(_input, runtime) {
    const records = this.salesStore.today();
    const revenue = Math.round(records.reduce((sum, item) => sum + item.revenue, 0) * 100) / 100;
    const profit = Math.round(records.reduce((sum, item) => sum + item.profit, 0) * 100) / 100;
    const quantity = records.reduce((sum, item) => sum + item.quantity, 0);
    const target = targetFromGoal(runtime.chain.goal);
    return success({
      date: new Date().toLocaleDateString("zh-CN"),
      orders: records.filter((item) => item.quantity > 0).length,
      quantity,
      revenue,
      profit,
      target,
      targetReached: target === null ? null : profit >= target,
      summary: quantity > 0
        ? `今天记录成交 ${quantity} 件，收入 ¥${revenue}，利润 ¥${profit}。`
        : "今天尚未记录成交，利润为 ¥0。",
      nextAction: target !== null && profit < target
        ? `距离 ¥${target} 的目标还差 ¥${Math.round((target - profit) * 100) / 100}，下一轮继续寻找候选商品。`
        : "复盘成交商品，保留有效做法并继续小规模验证。",
    });
  }
}

export function createChainTools({ productStore, salesStore }) {
  return [
    new ChainProductDiscoveryTool(productStore),
    chainProfitScreenTool,
    chainContentGenerateTool,
    chainImagePrepareTool,
    chainPublishPrepareTool,
    chainSaleWaitTool,
    new ChainSaleRecordTool(salesStore),
    new ChainDailyReportTool(salesStore),
  ];
}
