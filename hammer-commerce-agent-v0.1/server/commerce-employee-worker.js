import { createCommerceEmployee, dispatchCommerceMission } from "./commerce-employee-factory.js";

const args = process.argv.slice(2);
const daemonMode = !args.includes("--once") && !args.includes("--ask") && !args.includes("--health") && !args.includes("--record-outcome") && !args.includes("--feedback");
const { hammer, memoryFile } = createCommerceEmployee({ dailyEnabled: daemonMode });

hammer.eventBus.subscribe("commerce.daily.report.generated", (event) => {
  process.stdout.write(`${JSON.stringify(event.payload.report, null, 2)}\n`);
}, { subscriberId: "server.commerce-employee.report-output" });

async function run(goal) {
  await dispatchCommerceMission(hammer, goal || process.env.COMMERCE_DAILY_GOAL || "帮我找赚钱商品");
}

async function health() {
  const heartbeat = await hammer.memoryService.read("commerce.employee", "heartbeat");
  const latestReport = await hammer.memoryService.read("commerce.employee", "latest-report");
  const ageMs = heartbeat?.timestamp ? Date.now() - new Date(heartbeat.timestamp).getTime() : Infinity;
  const result = { healthy: ageMs < 180_000, heartbeat: heartbeat || null, latestReport: latestReport || null, memoryFile };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.healthy) process.exitCode = 1;
}

async function recordOutcome() {
  const index = args.indexOf("--record-outcome");
  const [productName, outcome, rawProfit, rawOrders] = args.slice(index + 1, index + 5);
  if (!productName || !outcome) throw new Error("用法：--record-outcome 商品名 SOLD|NO_SALE|RETURNED|LOSS [利润]");
  await hammer.eventBus.publish("commerce.outcome.recorded", {
    productName,
    outcome,
    profit: Number(rawProfit || 0),
    orders: Number(rawOrders || 0),
  }, { source: "owner.feedback" });
  process.stdout.write(`已写入学习记忆：${productName} / ${outcome} / ${Number(rawProfit || 0)}\n`);
}

async function feedback() {
  const index = args.indexOf("--feedback");
  const [productName, rawOrders, rawProfit] = args.slice(index + 1, index + 4);
  if (!productName) throw new Error("用法：--feedback 商品名 成交单数 实际利润");
  await hammer.eventBus.publish("commerce.outcome.recorded", {
    productName,
    orders: Number(rawOrders || 0),
    profit: Number(rawProfit || 0),
  }, { source: "owner.feedback" });
  process.stdout.write(`经验已更新：${productName} / 成交${Number(rawOrders || 0)}单 / 利润${Number(rawProfit || 0)}\n`);
}

try {
  if (args.includes("--once")) await run();
  else if (args.includes("--ask")) await run(args[args.indexOf("--ask") + 1]);
  else if (args.includes("--health")) await health();
  else if (args.includes("--record-outcome")) await recordOutcome();
  else if (args.includes("--feedback")) await feedback();
  else process.stdout.write(`Hammer Commerce Employee 已启动：每日 08:00 自主执行，数据 ${memoryFile}\n`);
} catch (error) {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
}
