import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { BaseAgent, createHammerOS, definePlugin, TOOL_TYPE } from "../hammer-os/index.js";
import { createCommercePlugin } from "../hammer-os/plugins/commerce/commerce-plugin.js";
import { PriorityTaskQueue } from "../hammer-os/core/runtime/priority-task-queue.js";
import { RuntimeScheduler } from "../hammer-os/core/scheduler/runtime-scheduler.js";

test("EventBus 将 Agent 事件同时交给 Decision、Memory 与 Logger", async () => {
  const os = createHammerOS();
  let decisionResult = null;
  os.decisionService.registerPolicy("test.browser-decision", async (input) => ({ accepted: input.price < 100 }));
  os.eventBus.subscribe("browser.completed", async (event) => {
    await os.eventBus.publish("decision.requested", {
      policyId: "test.browser-decision",
      input: event.payload,
    }, { source: "test.plugin", missionId: event.missionId });
  }, { subscriberId: "test.decision-router" });
  os.eventBus.subscribe("decision.completed", (event) => {
    decisionResult = event.payload.result;
  }, { subscriberId: "test.mission-observer" });

  await os.eventBus.publish("browser.completed", { price: 20 }, { source: "agent.browser", missionId: "MSN-1" });

  assert.deepEqual(decisionResult, { accepted: true });
  assert.ok((await os.memoryService.list("events")).some((entry) => entry.value.type === "browser.completed"));
  assert.ok(os.eventLogger.list({ missionId: "MSN-1" }).some((entry) => entry.type === "decision.completed"));
});

test("FinanceAgent 只继承 BaseAgent 即可在 Runtime 中运行、重试和保存 Checkpoint", async () => {
  let toolAttempts = 0;
  class FinanceAgent extends BaseAgent {
    static agentType = "finance";

    async onTask(task) {
      const result = await this.useTool("finance.calculate", task.input);
      await this.remember(task.id, result);
      await this.emit("finance.completed", result);
      return result;
    }
  }
  const financePlugin = definePlugin({
    manifest: { id: "finance-test", name: "Finance Test Plugin", version: "1.0.0" },
    agents: [FinanceAgent],
    tools: [{
      name: "finance.calculate",
      type: TOOL_TYPE.PLUGIN,
      async execute(input) {
        toolAttempts += 1;
        if (toolAttempts === 1) throw new Error("temporary finance failure");
        return { profit: input.revenue - input.cost };
      },
    }],
    planners: {
      finance: (mission) => [{
        id: `${mission.id}:finance:1`,
        title: "Finance Task",
        agentType: FinanceAgent.agentType,
        input: mission.input,
        maxRetries: 1,
      }],
    },
  });
  const os = createHammerOS({ plugins: [financePlugin] });

  const mission = await os.orchestrator.dispatch({
    type: "finance",
    goal: "计算利润",
    priority: 10,
    input: { revenue: 100, cost: 60 },
  });

  assert.equal(mission.status, "SUCCESS");
  assert.equal(mission.tasks[0].attempts, 2);
  assert.deepEqual(mission.tasks[0].output, { profit: 40 });
  assert.equal((await os.memoryService.read("runtime.checkpoints", mission.id)).status, "SUCCESS");
  assert.deepEqual(await os.memoryService.read("agent.finance", mission.tasks[0].id), { profit: 40 });
  assert.equal(os.runtime.listWorkers().length, 2);
  assert.ok(mission.events.some((event) => event.type === "finance.completed"));
});

test("Commerce 作为 Plugin 安装并通过 Orchestrator 运行", async () => {
  const os = createHammerOS({
    plugins: [createCommercePlugin({
      bridgeHandler: async (input) => ({ plugin: "commerce", accepted: true, input }),
    })],
  });

  const mission = await os.orchestrator.dispatch({
    type: "commerce",
    goal: "执行冻结的 Commerce Mission",
    input: { command: "compatibility-check" },
  });

  assert.equal(mission.status, "SUCCESS");
  assert.equal(mission.tasks[0].output.plugin, "commerce");
  assert.equal(os.pluginManager.list()[0].id, "commerce");
});

test("Runtime 的 Queue 与 Schedule 属于通用内核", () => {
  const queue = new PriorityTaskQueue();
  queue.enqueue({ id: "LOW", priority: 1 });
  queue.enqueue({ id: "HIGH", priority: 10 });
  assert.equal(queue.dequeue().id, "HIGH");

  let now = Date.parse("2026-07-19T00:00:00.000Z");
  const scheduler = new RuntimeScheduler({ now: () => now });
  scheduler.schedule({ id: "LATER" }, "2026-07-19T00:01:00.000Z");
  assert.equal(scheduler.due().length, 0);
  now += 60000;
  assert.equal(scheduler.due()[0].id, "LATER");
});

test("Orchestrator 可以取消等待调度的 Mission 并保存生命周期 Checkpoint", async () => {
  class ScheduledAgent extends BaseAgent {
    static agentType = "scheduled-test";
    async onTask() { return { executed: true }; }
  }
  const plugin = definePlugin({
    manifest: { id: "scheduled-test", name: "Scheduled Test", version: "1.0.0" },
    agents: [ScheduledAgent],
    planners: {
      scheduled: (mission) => [{
        id: `${mission.id}:scheduled:1`,
        title: "Scheduled Task",
        agentType: ScheduledAgent.agentType,
        runAt: "2099-01-01T00:00:00.000Z",
      }],
    },
  });
  const os = createHammerOS({ plugins: [plugin] });
  const waiting = await os.orchestrator.dispatch({ type: "scheduled", goal: "等待执行" });
  const cancelled = await os.orchestrator.cancel(waiting.id, "Architecture lifecycle test");

  assert.equal(waiting.status, "WAITING");
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.tasks[0].status, "CANCELLED");
  assert.equal((await os.memoryService.read("runtime.checkpoints", waiting.id)).status, "CANCELLED");
});

test("Core 不允许反向导入 Agent、Tool、Plugin 或 App 层", async () => {
  const coreRoot = path.resolve("hammer-os/core");
  const files = (await readdir(coreRoot, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(entry.parentPath, entry.name));
  for (const file of files) {
    const source = await readFile(file, "utf-8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    assert.ok(imports.every((specifier) => !/(^|\/)agents\/|(^|\/)tools\/|(^|\/)plugins\/|(^|\/)apps\//.test(specifier)), `${file} 跨层导入`);
  }
});
