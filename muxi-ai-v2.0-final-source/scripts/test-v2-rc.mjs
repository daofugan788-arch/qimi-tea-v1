import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { ExecutionPlanStatus } from "../js/agent/ExecutionPlan.js";
import { FileOrganizerAgent } from "../js/agents/FileOrganizerAgent.js";
import { LocalProductivityAgent } from "../js/agents/LocalProductivityAgent.js";
import { AutomationEngine } from "../js/automation/AutomationEngine.js";
import { AutomationRepository } from "../js/automation/AutomationRepository.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.get(key) || null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}

function createRepository(key) {
  return new AutomationRepository({ storage: new MemoryStorage(), key });
}

function createAgentRuntime(key) {
  const engine = new AutomationEngine({ repository: createRepository(key) });
  const fileAgent = new FileOrganizerAgent({
    intentRouter: engine.intentRouter,
    planner: engine.agentPlanner,
    taskQueue: engine.taskQueue,
    executor: engine.agentExecutor,
    toolRegistry: engine.agentExecutor.toolRegistry,
  });
  const productivityAgent = new LocalProductivityAgent({
    intentRouter: engine.intentRouter,
    planner: engine.agentPlanner,
    taskQueue: engine.taskQueue,
    executor: engine.agentExecutor,
    toolRegistry: engine.agentExecutor.toolRegistry,
  });
  return { engine, fileAgent, productivityAgent };
}

function pngSize(path) {
  const data = fs.readFileSync(path);
  assert.equal(data.toString("hex", 0, 8), "89504e470d0a1a0a");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function readAppShell(serviceWorkerSource) {
  const match = serviceWorkerSource.match(/const APP_SHELL=(\[[^;]+\]);/);
  if (!match) throw new Error("Service Worker 缺少 APP_SHELL");
  return JSON.parse(match[1]);
}

function cacheKey(request) {
  const raw = typeof request === "string" ? request : request?.url;
  if (/^https?:/i.test(raw || "")) {
    const url = new URL(raw);
    return url.pathname === "/" ? "./" : `.${url.pathname}`;
  }
  if (String(raw || "").startsWith("/")) return `.${raw}`;
  return String(raw || "");
}

class FakeResponse {
  constructor(body, status = 200) {
    this.body = body;
    this.status = status;
    this.ok = status >= 200 && status < 300;
  }
  clone() { return new FakeResponse(this.body, this.status); }
  async text() { return this.body; }
}

async function testOfflineServiceWorker(serviceWorkerSource, appShell, cacheName) {
  const listeners = new Map();
  const stores = new Map([["obsolete-cache", new Map([["./old.js", new FakeResponse("old")]])]]);
  let offline = false;
  let skippedWaiting = false;
  let claimedClients = false;

  function requireStore(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }

  function cacheFacade(name) {
    const store = requireStore(name);
    return {
      async addAll(entries) {
        for (const entry of entries) store.set(cacheKey(entry), new FakeResponse(`cached:${entry}`));
      },
      async match(request) {
        return store.get(cacheKey(request))?.clone();
      },
      async put(request, response) {
        store.set(cacheKey(request), response.clone());
      },
    };
  }

  const caches = {
    async open(name) { return cacheFacade(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request) {
      const key = cacheKey(request);
      for (const store of stores.values()) {
        if (store.has(key)) return store.get(key).clone();
      }
      return undefined;
    },
  };

  const self = {
    location: { origin: "https://muxi.test" },
    clients: { async claim() { claimedClients = true; } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    async skipWaiting() { skippedWaiting = true; },
  };

  const context = vm.createContext({
    self,
    caches,
    URL,
    fetch: async (request) => {
      if (offline) throw new Error("offline");
      return new FakeResponse(`network:${cacheKey(request)}`);
    },
    Promise,
  });
  vm.runInContext(serviceWorkerSource, context, { filename: "service-worker.js" });
  assert.ok(listeners.has("install"));
  assert.ok(listeners.has("activate"));
  assert.ok(listeners.has("fetch"));

  const installEvent = { waitUntil(value) { this.promise = Promise.resolve(value); } };
  listeners.get("install")(installEvent);
  await installEvent.promise;
  assert.equal(skippedWaiting, true);
  assert.equal(requireStore(cacheName).size, appShell.length);

  const activateEvent = { waitUntil(value) { this.promise = Promise.resolve(value); } };
  listeners.get("activate")(activateEvent);
  await activateEvent.promise;
  assert.equal(claimedClients, true);
  assert.deepEqual(await caches.keys(), [cacheName]);

  offline = true;
  let navigationResponsePromise = null;
  listeners.get("fetch")({
    request: { method: "GET", mode: "navigate", url: "https://muxi.test/unknown-page" },
    respondWith(value) { navigationResponsePromise = Promise.resolve(value); },
  });
  const navigationResponse = await navigationResponsePromise;
  assert.equal(await navigationResponse.text(), "cached:./index.html");

  let staticResponsePromise = null;
  listeners.get("fetch")({
    request: { method: "GET", mode: "same-origin", url: "https://muxi.test/js/app.js" },
    respondWith(value) { staticResponsePromise = Promise.resolve(value); },
  });
  const staticResponse = await staticResponsePromise;
  assert.equal(await staticResponse.text(), "cached:./js/app.js");

  let apiIntercepted = false;
  listeners.get("fetch")({
    request: { method: "GET", mode: "same-origin", url: "https://muxi.test/api/health" },
    respondWith() { apiIntercepted = true; },
  });
  assert.equal(apiIntercepted, false);

  return {
    installCached: appShell.length,
    oldCacheRemoved: true,
    navigationFallback: true,
    cachedStaticAsset: true,
    apiBypassed: true,
  };
}

class BlockingActionExecutor {
  constructor() {
    this.started = new Promise((resolve) => { this.resolveStarted = resolve; });
  }

  async execute(action, { signal } = {}) {
    this.resolveStarted(action.type);
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("任务已取消", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", () => reject(new DOMException("任务已取消", "AbortError")), { once: true });
    });
  }
}

const manifest = JSON.parse(fs.readFileSync("manifest.webmanifest", "utf8"));
assert.equal(manifest.name, "暮曦 AI");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.orientation, "portrait-primary");
assert.equal(manifest.start_url, "./#home");
assert.equal(manifest.scope, "./");
assert.equal(manifest.lang, "zh-CN");
assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any"));
assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
assert.deepEqual(pngSize("assets/icons/icon-192.png"), { width: 192, height: 192 });
assert.deepEqual(pngSize("assets/icons/icon-512.png"), { width: 512, height: 512 });
assert.deepEqual(pngSize("assets/icons/maskable-512.png"), { width: 512, height: 512 });

const indexSource = fs.readFileSync("index.html", "utf8");
const appSource = fs.readFileSync("js/app.js", "utf8");
assert.match(indexSource, /<meta name="viewport"[^>]*viewport-fit=cover/);
assert.match(indexSource, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
assert.match(appSource, /beforeinstallprompt/);
assert.match(appSource, /navigator\.serviceWorker\.register\("\.\/service-worker\.js"\)/);

const serviceWorkerSource = fs.readFileSync("service-worker.js", "utf8");
const cacheName = serviceWorkerSource.match(/const CACHE_NAME="([^"]+)"/)?.[1];
assert.ok(cacheName);
const appShell = readAppShell(serviceWorkerSource);
const missingCacheFiles = appShell
  .filter((entry) => entry !== "./")
  .filter((entry) => !fs.existsSync(entry.replace(/^\.\//, "")));
assert.deepEqual(missingCacheFiles, []);
const offlineResult = await testOfflineServiceWorker(serviceWorkerSource, appShell, cacheName);

let remoteCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  remoteCallCount += 1;
  throw new Error("muxi-ai-v2.0-final 本地验收禁止远程请求");
};

try {
  // 连续执行：并发提交后仍由 TaskQueue 串行处理，所有计划都必须成功收敛。
  const continuousRuntime = createAgentRuntime("test.v2.rc.continuous");
  const activeQueueTasks = new Set();
  let maxConcurrentQueueTasks = 0;
  continuousRuntime.engine.taskQueue.subscribe((event) => {
    if (event.type === "queue_item_started") activeQueueTasks.add(event.taskId);
    if (["queue_item_finished", "queue_item_failed", "queue_item_cancelled"].includes(event.type)) {
      activeQueueTasks.delete(event.taskId);
    }
    maxConcurrentQueueTasks = Math.max(maxConcurrentQueueTasks, activeQueueTasks.size);
  });

  const contentRuns = Array.from({ length: 12 }, (_, index) => (
    continuousRuntime.productivityAgent.runContent({
      productName: `测试产品 ${index + 1}`,
      highlights: ["本地运行", "任务可追踪"],
    })
  ));
  const customerRuns = Array.from({ length: 6 }, (_, index) => (
    continuousRuntime.productivityAgent.runCustomer({
      records: [{ customer: `客户 ${index + 1}`, note: "今天需要回访" }],
    })
  ));
  const continuousResults = await Promise.all([...contentRuns, ...customerRuns]);
  assert.equal(continuousResults.length, 18);
  assert.ok(continuousResults.every((output) => output.plan.status === ExecutionPlanStatus.SUCCESS));
  assert.ok(continuousResults.every((output) => output.completed));
  assert.equal(maxConcurrentQueueTasks, 1);
  assert.equal(continuousRuntime.engine.taskQueue.getSnapshot().isProcessing, false);
  assert.equal(continuousRuntime.engine.taskQueue.getSnapshot().pending.length, 0);
  assert.equal(continuousRuntime.engine.agentExecutor.getExecutions().length, 24);

  // 取消：未执行任务可从队列取消；运行中任务可通过 AbortController 停止。
  const pendingCancelEngine = new AutomationEngine({ repository: createRepository("test.v2.rc.pending-cancel") });
  const pendingTask = pendingCancelEngine.createTask("打开设置");
  pendingCancelEngine.enqueueTask(pendingTask.id);
  assert.equal(pendingCancelEngine.cancelQueuedTask(pendingTask.id), true);
  assert.equal(pendingCancelEngine.getTask(pendingTask.id).status, "cancelled");
  assert.equal(pendingCancelEngine.getTaskQueueSnapshot().pending.length, 0);

  const blockingExecutor = new BlockingActionExecutor();
  const activeCancelEngine = new AutomationEngine({
    executor: blockingExecutor,
    repository: createRepository("test.v2.rc.active-cancel"),
  });
  const activeTask = activeCancelEngine.createTask("打开设置");
  activeCancelEngine.enqueueTask(activeTask.id);
  const activeRunPromise = activeCancelEngine.runTaskQueue();
  await Promise.race([
    blockingExecutor.started,
    new Promise((_, reject) => setTimeout(() => reject(new Error("运行中取消测试超时")), 2000)),
  ]);
  assert.equal(activeCancelEngine.cancelCurrentTask(), true);
  assert.equal(activeCancelEngine.cancelCurrentTask(), false);
  const activeCancelSummary = await activeRunPromise;
  assert.equal(activeCancelEngine.getTask(activeTask.id).status, "cancelled");
  assert.equal(activeCancelEngine.getTaskExecution(activeTask.id).status, "cancelled");
  assert.equal(activeCancelSummary.cancelled, 1);
  assert.equal(activeCancelSummary.failed, 0);
  assert.equal(activeCancelEngine.activeTaskId, null);
  assert.equal(activeCancelEngine.getTaskQueueSnapshot().isProcessing, false);

  // 重复确认：首次确认成功；再次确认必须拒绝，且不产生重复执行记录。
  const confirmationRuntime = createAgentRuntime("test.v2.rc.confirmation");
  const preview = await confirmationRuntime.fileAgent.preview({
    files: [{ id: "f1", name: "资料.pdf", size: 1024, type: "application/pdf" }],
  });
  assert.equal(preview.requiresConfirmation, true);
  const confirmed = await confirmationRuntime.fileAgent.confirm(preview.plan.id);
  assert.equal(confirmed.plan.status, ExecutionPlanStatus.SUCCESS);
  const executionCountAfterConfirmation = confirmationRuntime.engine.agentExecutor.getExecutions().length;
  await assert.rejects(
    () => confirmationRuntime.fileAgent.confirm(preview.plan.id),
    /当前文件整理计划不需要确认/,
  );
  assert.equal(
    confirmationRuntime.engine.agentExecutor.getExecutions().length,
    executionCountAfterConfirmation,
  );
  const terminalPlan = await confirmationRuntime.engine.executeExecutionPlan(preview.plan.id, { confirmed: true });
  assert.equal(terminalPlan.status, ExecutionPlanStatus.SUCCESS);
  assert.equal(
    confirmationRuntime.engine.agentExecutor.getExecutions().length,
    executionCountAfterConfirmation,
  );

  // 异常输入：空指令、未知指令和超限输入必须可控失败，不能让队列卡住。
  const abnormalRuntime = createAgentRuntime("test.v2.rc.abnormal");
  assert.equal(abnormalRuntime.engine.recognizeIntent("   ").matched, false);
  assert.equal(abnormalRuntime.engine.createExecutionPlan("   ").status, ExecutionPlanStatus.BLOCKED);
  assert.equal(
    abnormalRuntime.engine.createExecutionPlan("请完成一个当前没有定义的任务").status,
    ExecutionPlanStatus.BLOCKED,
  );

  const tooManyHighlights = await abnormalRuntime.productivityAgent.runContent({
    highlights: Array.from({ length: 13 }, (_, index) => `卖点 ${index + 1}`),
  });
  assert.equal(tooManyHighlights.plan.status, ExecutionPlanStatus.FAILED);
  assert.match(tooManyHighlights.plan.error, /最多支持 12 项/);

  const tooManyRecords = await abnormalRuntime.productivityAgent.runCustomer({
    records: Array.from({ length: 501 }, (_, index) => ({ customer: `客户 ${index + 1}` })),
  });
  assert.equal(tooManyRecords.plan.status, ExecutionPlanStatus.FAILED);
  assert.match(tooManyRecords.plan.error, /最多整理 500 条/);

  const tooManyFiles = await abnormalRuntime.fileAgent.preview({
    files: Array.from({ length: 1001 }, (_, index) => ({ name: `文件-${index + 1}.txt` })),
  });
  assert.equal(tooManyFiles.plan.status, ExecutionPlanStatus.FAILED);
  assert.match(tooManyFiles.plan.error, /最多支持 1000 个文件/);

  const safePathPreview = await abnormalRuntime.fileAgent.preview({
    directory: "../../Download",
    files: [{ name: "../../隐私.txt" }],
  });
  assert.equal(safePathPreview.preview.directory, "Download");
  assert.equal(safePathPreview.preview.proposedMoves[0].fileName, "隐私.txt");
  assert.equal(safePathPreview.actualFileOperationExecuted, false);
  assert.equal(abnormalRuntime.engine.taskQueue.getSnapshot().isProcessing, false);
  assert.equal(abnormalRuntime.engine.taskQueue.getSnapshot().pending.length, 0);
  assert.equal(remoteCallCount, 0);

  console.log(JSON.stringify({
    suite: "暮曦 AI muxi-ai-v2.0-final Release Checklist",
    androidPreparation: {
      manifestValid: true,
      installPromptHook: true,
      serviceWorkerRegistration: true,
      icons: ["192x192", "512x512", "maskable-512x512"],
      actualAndroidDeviceRun: "manual_required",
    },
    offlineCache: {
      cacheName,
      appShellEntries: appShell.length,
      missingFiles: missingCacheFiles.length,
      ...offlineResult,
      actualAndroidOfflineRelaunch: "manual_required",
    },
    continuousExecution: {
      plans: continuousResults.length,
      toolTasks: continuousRuntime.engine.agentExecutor.getExecutions().length,
      maxConcurrentQueueTasks,
      allSucceeded: true,
      queueIdle: true,
    },
    cancellation: {
      pendingTaskCancelled: true,
      activeTaskCancelled: true,
      activeTaskFinalStatus: activeCancelEngine.getTask(activeTask.id).status,
      queueSummary: {
        cancelled: activeCancelSummary.cancelled,
        failed: activeCancelSummary.failed,
      },
    },
    repeatedConfirmation: {
      firstConfirmationSucceeded: true,
      secondConfirmationRejected: true,
      duplicateExecutionPrevented: true,
    },
    abnormalInput: {
      emptyInputBlocked: true,
      unknownInputBlocked: true,
      highlightsLimitEnforced: true,
      customerRecordLimitEnforced: true,
      fileLimitEnforced: true,
      pathTraversalSanitized: true,
      queueRecovered: true,
    },
    remoteCallCount,
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}
