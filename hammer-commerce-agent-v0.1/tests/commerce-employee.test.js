import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHammerOS, JsonFileMemoryAdapter } from "../hammer-os/index.js";
import { createCommercePlugin } from "../hammer-os/plugins/commerce/commerce-plugin.js";
import { DailyMissionService } from "../hammer-os/plugins/commerce/daily-mission-service.js";
import { EveningReportService } from "../hammer-os/plugins/commerce/evening-report-service.js";
import { createBrowserPlugin } from "../hammer-os/plugins/browser/browser-plugin.js";
import { dispatchCommerceMission } from "../server/commerce-employee-factory.js";

function product(index, overrides = {}) {
  return {
    id: `REAL-${index}`,
    name: `机会商品${index}`,
    source: "公开商品页",
    sourceUrl: `https://example.com/items/${index}`,
    price: 10 + index,
    marketReference: 39.9 + index,
    estimatedProfit: 29.9,
    salesText: "公开销量 100+",
    reviewText: "公开评价 20+",
    ratingText: "4.6",
    screenshotUrl: `/evidence/item-${index}.png`,
    capturedAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

function fakeSearchProvider() {
  return {
    name: "公开商品页",
    calls: 0,
    async search() {
      this.calls += 1;
      return [product(1), product(2), product(3), product(4, { marketReference: 12 })];
    },
  };
}

function employeeOS(provider = fakeSearchProvider(), options = {}) {
  return createHammerOS({
    ...options,
    plugins: [createCommercePlugin({ searchProviders: [provider] })],
  });
}

test("Commerce Employee 一条 Mission 自动完成 Search、Data、Decision、Content、Memory 和日报", async () => {
  const provider = fakeSearchProvider();
  const hammer = employeeOS(provider);
  const mission = await hammer.orchestrator.dispatch({
    type: "commerce.daily",
    goal: "找到今天最值得测试的3个商品",
    input: { searchGoal: "找100以内利润20以上的小商品", desiredCount: 3 },
  });

  assert.equal(mission.status, "SUCCESS");
  assert.equal(mission.tasks.length, 5);
  assert.deepEqual(mission.tasks.map((task) => task.agentType), ["commerce-product-search", "commerce", "commerce", "commerce-content", "commerce"]);
  const report = mission.tasks[4].output;
  assert.equal(report.scannedCount, 4);
  assert.equal(report.recommendedCount, 3);
  assert.equal(report.firstRecommendation.name, "机会商品1");
  assert.equal(report.publishingMaterials.length, 3);
  assert.ok(report.publishingMaterials[0].customerService.stock);
  assert.deepEqual(report.operationReduction, { before: 10, after: 1, reduced: 9, reductionRate: 90 });
  const opportunities = (await hammer.memoryService.list("commerce.opportunities")).map((entry) => entry.value);
  assert.equal(opportunities.length, 4);
  for (const item of opportunities) {
    for (const field of ["name", "source", "cost", "market_price", "profit", "risk", "decision", "reason", "timestamp"]) {
      assert.ok(Object.hasOwn(item, field), `Opportunity 缺少 ${field}`);
    }
  }
  assert.equal((await hammer.memoryService.read("commerce.employee", "latest-report")).missionId, mission.id);
  assert.ok(mission.events.some((event) => event.type === "commerce.products.searched"));
  assert.ok(mission.events.some((event) => event.type === "commerce.daily.report.generated"));
});

test("Learning Loop 将成交结果写入长期记忆并提高同类机会权重", async () => {
  const hammer = employeeOS();
  const opportunity = {
    name: "手机支架",
    source_url: "https://example.com/stand",
    screenshot: "/evidence/stand.png",
    timestamp: "2026-07-19T00:00:00.000Z",
    profit: 22,
    profit_rate: 40,
    minimum_profit: 20,
    sales_signal: "未公开",
    review_signal: "未公开",
    rating_signal: "4.5",
  };
  await hammer.memoryService.write("commerce.opportunities", "phone-stand", {
    id: "phone-stand",
    name: "手机支架",
    product_type: "Phone stand",
    history_results: [],
    experience: {},
  });
  const before = await hammer.decisionService.evaluate("commerce.opportunity.evaluate", { opportunity, outcomes: [] });
  await hammer.eventBus.publish("commerce.outcome.recorded", {
    productName: "手机支架",
    orders: 3,
    profit: 60,
  }, { source: "test.owner" });
  const outcomes = (await hammer.memoryService.list("commerce.outcomes")).map((entry) => entry.value);
  const after = await hammer.decisionService.evaluate("commerce.opportunity.evaluate", { opportunity, outcomes });

  assert.equal(outcomes.length, 1);
  assert.equal(after.learning.successes, 1);
  assert.equal(after.learning.orders, 3);
  assert.equal(after.score, before.score + 11);
  const learned = await hammer.memoryService.read("commerce.opportunities", "phone-stand");
  assert.equal(learned.history_results.length, 1);
  assert.equal(learned.experience.totalOrders, 3);
  assert.equal(learned.experience.totalProfit, 60);
});

test("Browser Plugin 真实执行位置位于搜索和机会入库之间", async () => {
  const provider = fakeSearchProvider();
  const verifier = {
    async verify({ runId, items }) {
      return {
        runId: `VERIFY-${runId}`,
        verifiedCount: items.length,
        evidenceFile: "/evidence/verify.json",
        errors: [],
        items: items.map((item, index) => ({
          ...item,
          browserVerified: true,
          browserVerifiedAt: "2026-07-19T00:01:00.000Z",
          screenshotUrl: `/evidence/verified-${index}.png`,
        })),
      };
    },
  };
  const hammer = createHammerOS({
    plugins: [
      createBrowserPlugin({ verifier }),
      createCommercePlugin({ searchProviders: [provider], browserVerification: true }),
    ],
  });
  const mission = await hammer.orchestrator.dispatch({
    type: "commerce.daily",
    goal: "今日寻找10个值得测试商品",
    input: { desiredCount: 10, contentCount: 3, reportLimit: 3, browserVerifyLimit: 12 },
  });

  assert.equal(mission.status, "SUCCESS");
  assert.deepEqual(mission.tasks.map((task) => task.agentType), ["commerce-product-search", "browser", "commerce", "commerce", "commerce-content", "commerce"]);
  assert.equal(mission.tasks[1].output.browserVerifiedCount, 4);
  assert.equal(mission.tasks[5].output.browserVerifiedCount, 4);
  assert.equal((await hammer.memoryService.read("commerce.opportunities", mission.tasks[3].output.evaluated[0].id)).browser_verified, true);
});

test("Daily Mission 08:00 自动执行、同一天幂等并跨24小时产生新成果", async () => {
  const provider = fakeSearchProvider();
  const hammer = employeeOS(provider);
  let now = new Date("2026-07-19T00:01:00.000Z");
  const daily = new DailyMissionService({
    orchestrator: hammer.orchestrator,
    memoryService: hammer.memoryService,
    eventBus: hammer.eventBus,
    now: () => now,
    timeZone: "Asia/Shanghai",
    keepAlive: false,
  });

  const dayOne = await daily.tick();
  const duplicate = await daily.tick();
  now = new Date("2026-07-20T00:01:00.000Z");
  const dayTwo = await daily.tick();

  assert.equal(dayOne.status, "SUCCESS");
  assert.equal(duplicate.status, "ALREADY_COMPLETED");
  assert.equal(dayTwo.status, "SUCCESS");
  assert.notEqual(dayOne.id, dayTwo.id);
  assert.equal(provider.calls, 2);
  assert.equal((await hammer.memoryService.read("commerce.daily-schedule", "2026-07-19")).status, "SUCCESS");
  assert.equal((await hammer.memoryService.read("commerce.daily-schedule", "2026-07-20")).status, "SUCCESS");
  assert.equal((await hammer.memoryService.read("commerce.employee", "heartbeat")).status, "ALIVE");
});

test("20:00 晚班只汇总当天机会并生成 TOP3 商业报告", async () => {
  const hammer = employeeOS();
  await hammer.orchestrator.dispatch({
    type: "commerce.daily",
    goal: "今日寻找10个值得测试商品",
    input: { dailyDate: "2026-07-19", desiredCount: 10, contentCount: 3, reportLimit: 3 },
    metadata: { source: "daily-08:00" },
  });
  const evening = new EveningReportService({
    orchestrator: hammer.orchestrator,
    memoryService: hammer.memoryService,
    eventBus: hammer.eventBus,
    now: () => new Date("2026-07-19T12:01:00.000Z"),
    timeZone: "Asia/Shanghai",
    keepAlive: false,
  });
  const mission = await evening.tick();
  const duplicate = await evening.tick();

  assert.equal(mission.status, "SUCCESS");
  assert.equal(mission.tasks[0].output.title, "今日商业机会报告");
  assert.equal(mission.tasks[0].output.date, "2026-07-19");
  assert.equal(mission.tasks[0].output.top3.length, 3);
  assert.equal(duplicate.status, "ALREADY_COMPLETED");
});

test("JsonFileMemoryAdapter 让机会库和日报跨进程重启保留", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hammer-memory-"));
  const file = path.join(directory, "memory.json");
  const first = employeeOS(fakeSearchProvider(), { memoryAdapter: new JsonFileMemoryAdapter(file) });
  await first.orchestrator.dispatch({
    type: "commerce.daily",
    goal: "找到3个机会",
    input: { searchGoal: "找小商品", desiredCount: 3 },
  });
  const second = createHammerOS({ memoryAdapter: new JsonFileMemoryAdapter(file) });

  assert.equal((await second.memoryService.list("commerce.opportunities")).length, 4);
  assert.equal((await second.memoryService.list("commerce.daily-reports")).length, 1);
  assert.ok(JSON.parse(await readFile(file, "utf-8"))["commerce.opportunities"]);
});

test("手机入口未填写成本项时不会覆盖默认运费和平台费", async () => {
  let dispatched = null;
  const hammer = {
    orchestrator: {
      async dispatch(input) {
        dispatched = input;
        return { status: "SUCCESS", tasks: [{ input: { action: "report" }, output: { ok: true } }] };
      },
    },
  };
  await dispatchCommerceMission(hammer, "帮我找赚钱商品", {
    shippingCost: undefined,
    platformRate: undefined,
    source: "mobile-web",
  }, {
    COMMERCE_SHIPPING_COST: "5",
    COMMERCE_PLATFORM_RATE: "0.05",
  });

  assert.equal(dispatched.input.shippingCost, 5);
  assert.equal(dispatched.input.platformRate, 0.05);
  assert.equal(dispatched.metadata.source, "mobile-web");
});
