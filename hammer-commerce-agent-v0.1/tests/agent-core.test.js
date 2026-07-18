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
