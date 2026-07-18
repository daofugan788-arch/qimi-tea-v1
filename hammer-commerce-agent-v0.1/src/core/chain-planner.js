import { CHAIN_STEP_STATUS } from "./chain-status.js";

const CHAIN_TEMPLATE = Object.freeze([
  { tool: "chain.product.discover", title: "寻找候选商品", description: "从现有商品库寻找尚未尝试的候选项" },
  { tool: "chain.profit.screen", title: "检查利润是否可卖", description: "不达标时自动回到选品步骤继续寻找" },
  { tool: "chain.content.generate", title: "生成商品资料", description: "生成个人卖家风格标题、描述和回复话术" },
  { tool: "chain.image.prepare", title: "准备图片任务", description: "生成需要拍摄或准备的图片清单" },
  { tool: "chain.publish.prepare", title: "准备发布", description: "等待 Browser Agent 或主人确认已发布" },
  { tool: "chain.sale.wait", title: "等待成交结果", description: "保存任务进度，收到成交结果后继续" },
  { tool: "chain.sale.record", title: "记录成交利润", description: "计算真实成交利润并写入销售记录" },
  { tool: "chain.daily.report", title: "生成今日汇报", description: "汇总今日成交、利润和下一步建议" },
]);

export class ChainPlanner {
  createPlan() {
    return CHAIN_TEMPLATE.map((step, index) => ({
      id: `CHAIN-S${index + 1}`,
      index,
      ...step,
      status: CHAIN_STEP_STATUS.WAITING,
      output: null,
      error: null,
    }));
  }
}
