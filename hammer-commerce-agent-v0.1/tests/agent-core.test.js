import test from "node:test";
import assert from "node:assert/strict";
import { createCommerceAgent } from "../src/core/create-agent.js";
import { AgentExecutor } from "../src/core/agent-executor.js";
import { TaskStore } from "../src/core/task-store.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { TASK_STATUS } from "../src/core/task-status.js";
import { ProfitCalculatorTool } from "../src/tools/profit-calculator-tool.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

test("创建任务时生成完整 WAITING 数据结构", () => {
  const storage = new MemoryStorage();
  const agent = createCommerceAgent({ storage, stepDelay: 0 });
  const task = agent.createTask("找适合闲鱼卖的小商品");

  assert.match(task.id, /^HCA-/);
  assert.equal(task.goal, "找适合闲鱼卖的小商品");
  assert.equal(task.status, TASK_STATUS.WAITING);
  assert.equal(task.result, null);
  assert.deepEqual(task.steps, []);
});

test("Agent 可以拆解目标、执行工具并输出报告", async () => {
  const storage = new MemoryStorage();
  const agent = createCommerceAgent({ storage, stepDelay: 0 });
  const updates = [];
  const completed = await agent.run(
    "帮我找利润率35%以上、适合闲鱼卖的小商品",
    (task) => updates.push(task.status),
  );

  assert.equal(completed.status, TASK_STATUS.SUCCESS);
  assert.equal(completed.steps.length, 4);
  assert.ok(completed.steps.every((step) => step.status === TASK_STATUS.SUCCESS));
  assert.equal(completed.result.metrics[0].value, "闲鱼");
  assert.equal(completed.result.metrics[2].value, "≥ 35%");
  assert.equal(completed.result.actions.length, 4);
  assert.ok(updates.includes(TASK_STATUS.RUNNING));
  assert.equal(updates.at(-1), TASK_STATUS.SUCCESS);
});

test("任务历史可以在刷新后从本机存储恢复", async () => {
  const storage = new MemoryStorage();
  const firstAgent = createCommerceAgent({ storage, stepDelay: 0 });
  await firstAgent.run("规划一个低成本个人卖货测试");

  const reloadedAgent = createCommerceAgent({ storage, stepDelay: 0 });
  const history = reloadedAgent.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].status, TASK_STATUS.SUCCESS);
  assert.equal(history[0].goal, "规划一个低成本个人卖货测试");
});

test("工具失败时任务进入 FAILED 并保存错误", async () => {
  const storage = new MemoryStorage();
  const store = new TaskStore(storage);
  const registry = new ToolRegistry().register({
    name: "test.fail",
    async execute() { throw new Error("测试工具失败"); },
  });
  const executor = new AgentExecutor({ store, registry, stepDelay: 0 });
  const task = store.create("测试失败状态");
  const plan = [{
    id: `${task.id}-S1`,
    index: 0,
    title: "执行失败工具",
    tool: "test.fail",
    status: TASK_STATUS.WAITING,
    output: null,
    error: null,
  }];
  const failed = await executor.run(task, plan);

  assert.equal(failed.status, TASK_STATUS.FAILED);
  assert.equal(failed.error, "测试工具失败");
  assert.equal(failed.steps[0].status, TASK_STATUS.FAILED);
});

test("ProfitCalculatorTool 正确计算利润、利润率和最低成交价", async () => {
  const tool = new ProfitCalculatorTool();
  const result = await tool.execute({}, {
    outputs: {
      "product.normalize": {
        name: "桌面风扇",
        cost: 15,
        price: 39.9,
        shipping: 5,
        platformFee: 2,
      },
    },
  });

  assert.equal(result.grossProfit, 19.9);
  assert.equal(result.netProfit, 17.9);
  assert.equal(result.profitRate, 44.86);
  assert.equal(result.minimumDealPrice, 22);
  assert.ok(result.recommendedPrice >= 31.43);
});

test("商品分析 Agent 输出商业报告并保存 Products 商品库", async () => {
  const storage = new MemoryStorage();
  const agent = createCommerceAgent({ storage, stepDelay: 0 });
  const completed = await agent.runProductAnalysis({
    name: "桌面风扇",
    cost: 15,
    price: 39.9,
    shipping: 5,
    platformFee: 0,
    note: "夏季商品、小件、一件代发",
  });

  assert.equal(completed.status, TASK_STATUS.SUCCESS);
  assert.equal(completed.steps.length, 5);
  assert.equal(completed.result.kind, "PRODUCT_ANALYSIS");
  assert.equal(completed.result.product.name, "桌面风扇");
  assert.equal(completed.result.profit.net, 19.9);
  assert.equal(completed.result.profit.rate, 49.87);
  assert.ok(completed.result.score.total >= 0 && completed.result.score.total <= 100);
  assert.ok(completed.result.risks.length > 0);
  assert.ok(completed.result.nextActions.length > 0);

  const products = agent.getProducts();
  assert.equal(products.length, 1);
  assert.match(products[0].id, /^PRD-/);
  assert.equal(products[0].name, "桌面风扇");
  assert.equal(products[0].cost, 15);
  assert.equal(products[0].price, 39.9);
  assert.equal(products[0].profit, 19.9);
  assert.equal(products[0].score, completed.result.score.total);
  assert.ok(products[0].created_time);
});

test("选品 Agent 可以对商品库候选项排序并输出优先测试商品", async () => {
  const storage = new MemoryStorage();
  const agent = createCommerceAgent({ storage, stepDelay: 0 });
  await agent.runProductAnalysis({
    name: "桌面风扇", cost: 15, price: 39.9, shipping: 5, platformFee: 0,
    note: "夏季商品、小件、一件代发",
  });
  await agent.runProductAnalysis({
    name: "便携收纳袋", cost: 4, price: 19.9, shipping: 3, platformFee: 1,
    note: "小件、轻、不易坏、竞争小",
  });
  const productIds = agent.getProducts().map((product) => product.id);
  const completed = await agent.runProductComparison(productIds);

  assert.equal(completed.status, TASK_STATUS.SUCCESS);
  assert.equal(completed.type, "PRODUCT_COMPARISON");
  assert.equal(completed.steps.length, 3);
  assert.equal(completed.result.kind, "SELECTION_COMPARISON");
  assert.equal(completed.result.rankings.length, 2);
  assert.ok(completed.result.winner);
  assert.equal(completed.result.rankings[0].id, completed.result.winner.id);
  assert.ok(completed.result.rankings[0].score >= completed.result.rankings[1].score);
  assert.ok(completed.result.testPlan.length >= 3);
});

test("任务链在没有商品时安全暂停并说明所需能力", async () => {
  const storage = new MemoryStorage();
  const agent = createCommerceAgent({ storage, stepDelay: 0 });
  const chain = await agent.runTaskChain("帮我今天赚100块");

  assert.equal(chain.status, "BLOCKED");
  assert.equal(chain.currentStepIndex, 0);
  assert.equal(chain.blocked.actionType, "NEED_PRODUCTS");
  assert.match(chain.blocked.reason, /Browser Agent 尚未接入/);
  assert.equal(agent.getChains().length, 1);
});

test("任务链可自动筛选商品并推进到发布等待点", async () => {
  const storage = new MemoryStorage();
  const agent = createCommerceAgent({ storage, stepDelay: 0 });
  await agent.runProductAnalysis({
    name: "便携收纳袋", cost: 4, price: 19.9, shipping: 3, platformFee: 1,
    note: "小件、轻、不易坏、竞争小",
  });
  const chain = await agent.runTaskChain("帮我今天卖一个商品");

  assert.equal(chain.status, "BLOCKED");
  assert.equal(chain.blocked.actionType, "CONFIRM_PUBLISH");
  assert.equal(chain.currentStepIndex, 4);
  assert.ok(chain.context.outputs["chain.content.generate"].title);
  assert.equal(chain.steps[0].status, "SUCCESS");
  assert.equal(chain.steps[3].status, "SUCCESS");
});

test("任务链恢复后能记录成交利润并完成今日汇报", async () => {
  const storage = new MemoryStorage();
  const agent = createCommerceAgent({ storage, stepDelay: 0 });
  await agent.runProductAnalysis({
    name: "便携收纳袋", cost: 4, price: 19.9, shipping: 3, platformFee: 1,
    note: "小件、轻、不易坏、竞争小",
  });
  let chain = await agent.runTaskChain("帮我今天赚10块");
  chain = await agent.resumeTaskChain(chain.id, { published: true });
  assert.equal(chain.status, "BLOCKED");
  assert.equal(chain.blocked.actionType, "WAIT_SALE_RESULT");

  chain = await agent.resumeTaskChain(chain.id, {
    saleResult: { quantity: 1, salePrice: 19.9 },
  });
  assert.equal(chain.status, "SUCCESS");
  assert.equal(chain.result.quantity, 1);
  assert.equal(chain.result.revenue, 19.9);
  assert.equal(chain.result.profit, 11.9);
  assert.equal(chain.result.target, 10);
  assert.equal(chain.result.targetReached, true);
  assert.equal(agent.getSales().length, 1);
});

test("利润不达标时任务链会自动放弃并继续寻找下一个商品", async () => {
  const storage = new MemoryStorage();
  const agent = createCommerceAgent({ storage, stepDelay: 0 });
  agent.productStore.saveAnalysis(
    { name: "亏损候选", cost: 20, price: 18, shipping: 3, platformFee: 0 },
    { profit: { net: -5, rate: -27.78 }, score: { total: 99 }, recommendation: { label: "测试数据" } },
  );
  agent.productStore.saveAnalysis(
    { name: "可卖候选", cost: 5, price: 20, shipping: 3, platformFee: 1 },
    { profit: { net: 11, rate: 55 }, score: { total: 80 }, recommendation: { label: "适合测试" } },
  );
  const chain = await agent.runTaskChain("帮我卖一个商品");

  assert.equal(chain.status, "BLOCKED");
  assert.equal(chain.blocked.actionType, "CONFIRM_PUBLISH");
  assert.equal(chain.context.attempts.length, 1);
  assert.equal(chain.context.attempts[0].productName, "亏损候选");
  assert.equal(chain.context.outputs["chain.profit.screen"].product.name, "可卖候选");
});
