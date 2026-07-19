import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DailyMissionService } from "../hammer-os/plugins/commerce/daily-mission-service.js";
import { EveningReportService } from "../hammer-os/plugins/commerce/evening-report-service.js";
import { createCommerceEmployee, defaultMissionInput } from "./commerce-employee-factory.js";

const args = process.argv.slice(2);
const modeIndex = args.indexOf("--mode");
const mode = modeIndex >= 0 ? args[modeIndex + 1] : "heartbeat";
const dataDirectory = path.resolve(process.env.HAMMER_DATA_DIR || "runtime-data");
const publicDirectory = path.resolve(process.env.HAMMER_PUBLIC_DIR || "alpha-public");
const { hammer, memoryFile } = createCommerceEmployee({ dailyEnabled: false });

function localDate(now = new Date(), timeZone = process.env.COMMERCE_DAILY_TIMEZONE || "Asia/Shanghai") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

async function heartbeat() {
  const now = new Date();
  const previous = await hammer.memoryService.read("commerce.alpha-soak", "current") || {};
  const previousAt = previous.lastHeartbeatAt ? new Date(previous.lastHeartbeatAt) : null;
  const gapHours = previousAt ? (now.getTime() - previousAt.getTime()) / 3_600_000 : 0;
  const continuousSince = !previous.continuousSince || gapHours > 2.5 ? now.toISOString() : previous.continuousSince;
  const firstStartedAt = previous.firstStartedAt || now.toISOString();
  const hoursObserved = Math.max(0, (now.getTime() - new Date(continuousSince).getTime()) / 3_600_000);
  const daysObserved = Math.max(0, (now.getTime() - new Date(firstStartedAt).getTime()) / 86_400_000);
  const reportDays = new Set((await hammer.memoryService.list("commerce.daily-reports")).map((entry) => entry.value?.date || entry.key)).size;
  const status = daysObserved >= 7 && reportDays >= 7
    ? "SEVEN_DAY_VERIFIED"
    : hoursObserved >= 24 ? "ONLINE_24H_VERIFIED" : "RUNNING";
  const soak = {
    status,
    firstStartedAt,
    continuousSince,
    lastHeartbeatAt: now.toISOString(),
    heartbeatCount: Number(previous.heartbeatCount || 0) + 1,
    hoursObserved: Math.round(hoursObserved * 100) / 100,
    daysObserved: Math.round(daysObserved * 100) / 100,
    reportDays,
    largestGapHours: Math.max(Number(previous.largestGapHours || 0), Math.round(gapHours * 100) / 100),
    acceptance: {
      online24Hours: hoursObserved >= 24,
      sevenDays: daysObserved >= 7 && reportDays >= 7,
    },
  };
  await hammer.memoryService.write("commerce.alpha-soak", "current", soak);
  await hammer.memoryService.write("commerce.alpha-heartbeats", now.toISOString(), {
    timestamp: now.toISOString(),
    mode,
    status,
  });
  await hammer.memoryService.write("commerce.employee", "heartbeat", {
    status: "ALIVE",
    timestamp: now.toISOString(),
    runtime: "scheduled-worker",
    nextMorningTime: "08:00 Asia/Shanghai",
    nextEveningTime: "20:00 Asia/Shanghai",
  });
  return soak;
}

async function morning({ allowEarly = false } = {}) {
  const date = localDate();
  const existing = await hammer.memoryService.read("commerce.daily-schedule", date);
  if (existing?.status === "SUCCESS") return { status: "ALREADY_COMPLETED", date, missionId: existing.missionId };
  const fixed = defaultMissionInput(process.env, { useFixedConstraints: true });
  const service = new DailyMissionService({
    orchestrator: hammer.orchestrator,
    memoryService: hammer.memoryService,
    eventBus: hammer.eventBus,
    timeZone: process.env.COMMERCE_DAILY_TIMEZONE || "Asia/Shanghai",
    goal: process.env.COMMERCE_DAILY_GOAL || "今日寻找10个值得测试商品",
    searchGoal: process.env.COMMERCE_SEARCH_GOAL || "寻找价格100以内、预计利润20以上的热门小商品",
    constraints: fixed.constraints,
    shippingCost: fixed.shippingCost,
    platformRate: fixed.platformRate,
    otherCost: fixed.otherCost,
    keepAlive: false,
  });
  return service.tick({ force: allowEarly });
}

async function evening({ force = false } = {}) {
  const service = new EveningReportService({
    orchestrator: hammer.orchestrator,
    memoryService: hammer.memoryService,
    eventBus: hammer.eventBus,
    timeZone: process.env.COMMERCE_DAILY_TIMEZONE || "Asia/Shanghai",
    keepAlive: false,
  });
  return service.tick({ force });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function reportMarkdown(report, soak) {
  const top3 = report?.top3 || [];
  return [
    "# 《商业机会日报》",
    "",
    `日期：${report?.date || "尚未生成"}`,
    "",
    `扫描数量：${report?.scannedCount || 0}`,
    "",
    `发现机会：${report?.opportunityCount || 0}`,
    "",
    "## TOP3",
    "",
    ...top3.flatMap((item, index) => [
      `### ${index + 1}. ${item.name}`,
      "",
      `- 来源：${item.source}`,
      `- 成本：${item.currency || ""} ${item.cost}`,
      `- 售价：${item.currency || ""} ${item.market_price}`,
      `- 利润：${item.currency || ""} ${item.profit}`,
      `- 推荐等级：${item.decision}`,
      `- 风险：${item.risk}`,
      `- 推荐理由：${item.reason}`,
      `- 证据：${item.browser_verified ? "Browser 已打开并截图" : "公开目录数据，商品页未核验"}`,
      "",
    ]),
    `今日策略：${report?.todayStrategy || "等待首份日报"}`,
    "",
    "## 长期运行验收",
    "",
    `- 状态：${soak?.status || "尚未启动"}`,
    `- 已观察：${soak?.hoursObserved || 0} 小时 / ${soak?.daysObserved || 0} 天`,
    `- 日报天数：${soak?.reportDays || 0}/7`,
    `- 24小时验收：${soak?.acceptance?.online24Hours ? "通过" : "进行中"}`,
    `- 7天验收：${soak?.acceptance?.sevenDays ? "通过" : "进行中"}`,
    "",
    "> 不登录、不发布、不下单、不付款。利润为公开样本估算，投入资金前保留主人确认。",
  ].join("\n");
}

async function exportStatus() {
  const report = await hammer.memoryService.read("commerce.employee", "latest-report");
  const soak = await hammer.memoryService.read("commerce.alpha-soak", "current");
  await mkdir(publicDirectory, { recursive: true });
  await mkdir(path.join(dataDirectory, "reports"), { recursive: true });
  const payload = { report: report || null, soak: soak || null, exportedAt: new Date().toISOString() };
  await writeFile(path.join(publicDirectory, "latest-report.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  await writeFile(path.join(dataDirectory, "reports", `${report?.date || localDate()}-business-report.md`), `${reportMarkdown(report, soak)}\n`, "utf-8");
  const cards = (report?.top3 || []).map((item, index) => `
    <article><span class="rank">TOP ${index + 1} · ${escapeHtml(item.decision)}</span><h2>${escapeHtml(item.name)}</h2>
    <p>${escapeHtml(item.source)}</p><div class="numbers"><b>成本 ${escapeHtml(item.currency)} ${escapeHtml(item.cost)}</b><b>售价 ${escapeHtml(item.currency)} ${escapeHtml(item.market_price)}</b><b class="profit">利润 ${escapeHtml(item.currency)} ${escapeHtml(item.profit)}</b></div>
    <p>${escapeHtml(item.reason)}</p><small>${item.browser_verified ? "✅ Browser 已真实打开并截图" : "⚠️ 公开目录数据，商品页尚未核验"}</small></article>`).join("");
  const statusText = soak?.acceptance?.sevenDays ? "7天验收通过" : soak?.acceptance?.online24Hours ? "24小时验收通过，继续跑满7天" : "长期运行测试中";
  await writeFile(path.join(publicDirectory, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="300"><title>Hammer Commerce Employee Alpha</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f6f2;color:#172018;font-family:system-ui,-apple-system,sans-serif}.wrap{max-width:720px;margin:auto;padding:24px 16px 60px}.hero{background:#10251b;color:white;border-radius:24px;padding:26px}.pill,.rank{display:inline-block;background:#d8f873;color:#183016;border-radius:999px;padding:7px 12px;font-weight:800;font-size:13px}h1{font-size:32px;line-height:1.1;margin:18px 0 8px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:18px 0}.metric,article{background:white;border:1px solid #dde4dc;border-radius:18px;padding:16px}.metric b{display:block;font-size:25px}.metric span,small{color:#667069}article{margin:12px 0}article h2{margin:13px 0 5px}.numbers{display:flex;flex-wrap:wrap;gap:8px}.numbers b{background:#f1f4ef;padding:8px;border-radius:9px}.numbers .profit{background:#dff7dd;color:#11672d}.strategy{background:#fff4cc;border-radius:18px;padding:18px;margin-top:18px}a{color:#195c33}@media(max-width:480px){h1{font-size:28px}.metrics{grid-template-columns:1fr}.metric{display:flex;justify-content:space-between;align-items:center}.metric b{font-size:22px}}
  </style></head><body><main class="wrap"><section class="hero"><span class="pill">Commerce Employee Alpha</span><h1>${escapeHtml(statusText)}</h1><p>每小时心跳 · 08:00 自动找货 · 20:00 自动日报</p><small style="color:#cbd8cf">最后心跳 ${escapeHtml(soak?.lastHeartbeatAt || "等待首次运行")}</small></section>
  <section class="metrics"><div class="metric"><b>${escapeHtml(report?.scannedCount || 0)}</b><span>扫描数量</span></div><div class="metric"><b>${escapeHtml(report?.opportunityCount || 0)}</b><span>发现机会</span></div><div class="metric"><b>${escapeHtml(soak?.reportDays || 0)}/7</b><span>日报进度</span></div></section>
  <h2>今日 TOP3</h2>${cards || "<article><h2>等待首份真实日报</h2><p>运行环境启动后会自动更新。</p></article>"}
  <section class="strategy"><b>今日策略</b><p>${escapeHtml(report?.todayStrategy || "等待首份真实日报")}</p></section>
  <p><a href="latest-report.json">查看机器可读报告</a></p><small>只读取公开页面，不登录、不发布、不下单、不付款。24小时与7天状态只在真实时间达到后自动转为通过。</small></main></body></html>`, "utf-8");
  return payload;
}

async function main() {
  let result = null;
  await heartbeat();
  if (mode === "full") result = await morning({ allowEarly: true });
  else if (mode === "morning") result = await morning();
  else if (mode === "evening") result = await evening();
  else if (mode !== "heartbeat" && mode !== "export") throw new Error(`未知模式：${mode}`);
  if (["full", "morning", "evening"].includes(mode)) await heartbeat();
  const exported = await exportStatus();
  process.stdout.write(`${JSON.stringify({
    mode,
    result: result ? { id: result.id || null, status: result.status, date: result.date || null, missionId: result.missionId || null } : null,
    soak: exported.soak,
    report: exported.report ? {
      date: exported.report.date,
      scannedCount: exported.report.scannedCount,
      opportunityCount: exported.report.opportunityCount,
      browserVerifiedCount: exported.report.browserVerifiedCount,
      top3: (exported.report.top3 || []).map((item) => ({ name: item.name, decision: item.decision, profit: item.profit, risk: item.risk })),
      evidenceFile: exported.report.evidenceFile,
    } : null,
    memoryFile,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
