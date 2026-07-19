import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BaseEmployee,
  createHammerOS,
  definePlugin,
  EMPLOYEE_HEALTH_CONDITION,
  EMPLOYEE_STATE,
  EmployeeHeartbeatMonitor,
  EmployeeLifecycle,
  JsonFileMemoryAdapter,
} from "../hammer-os/index.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ResearchEmployee extends BaseEmployee {
  static employeeType = "research";

  async execute(mission) {
    this.reportProgress(40, "researching");
    this.context.workspace.remember("last-goal", mission.goal);
    await wait(Number(mission.input.delayMs || 1));
    return { employee: "research", finding: mission.input.finding || "market-signal" };
  }
}

class FinanceEmployee extends BaseEmployee {
  static employeeType = "finance";

  async execute(mission) {
    this.reportProgress(50, "calculating");
    await wait(Number(mission.input.delayMs || 1));
    return { employee: "finance", amount: Number(mission.input.amount || 0) };
  }

  async onMessage(message) {
    if (message.type !== "PROFIT_REVIEW_REQUEST") return null;
    return this.reply(message, "PROFIT_REVIEW_COMPLETED", {
      approved: Number(message.payload.profit) > 0,
      reviewedBy: this.id,
    });
  }
}

test("没有 Commerce Plugin 时 Hammer OS 和 Employee Framework 正常启动", async () => {
  const hammer = createHammerOS();
  assert.ok(hammer.supervisor);
  assert.ok(hammer.employeeRuntime);
  assert.ok(hammer.employeeMessageBus);
  assert.ok(hammer.knowledgeCenter);
  assert.deepEqual(hammer.pluginManager.list(), []);

  const hired = await hammer.supervisor.hire(ResearchEmployee, { id: "research-standalone" });
  assert.equal(hired.state, EMPLOYEE_STATE.IDLE);
  const completed = await hammer.supervisor.assign(hired.id, { goal: "研究一个公开市场" });
  assert.equal(completed.result.employee, "research");
  await hammer.supervisor.retire(hired.id);
});

test("新增 Research 与 Finance Employee 不修改 Core 且可以同时运行", async () => {
  const hammer = createHammerOS();
  const research = await hammer.supervisor.hire(ResearchEmployee, { id: "research-parallel", heartbeatIntervalMs: 20 });
  const finance = await hammer.supervisor.hire(FinanceEmployee, { id: "finance-parallel", heartbeatIntervalMs: 20 });

  const [researchResult, financeResult] = await Promise.all([
    hammer.supervisor.assign(research.id, { goal: "研究机会", input: { delayMs: 20 } }),
    hammer.supervisor.assign(finance.id, { goal: "核算利润", input: { amount: 60, delayMs: 10 } }),
  ]);

  assert.equal(researchResult.result.employee, "research");
  assert.equal(financeResult.result.amount, 60);
  assert.equal(hammer.supervisor.employee(research.id).state, EMPLOYEE_STATE.IDLE);
  assert.equal(hammer.supervisor.employee(finance.id).state, EMPLOYEE_STATE.IDLE);
  await hammer.supervisor.retire(research.id);
  await hammer.supervisor.retire(finance.id);
});

test("Plugin 可以注册 Employee 类型并由 Supervisor 按类型招聘", async () => {
  let installedServices = null;
  const plugin = definePlugin({
    manifest: { id: "research-employee-plugin", version: "1.0.0", name: "Research Employee Plugin" },
    employees: [ResearchEmployee],
    onInstall(services) { installedServices = services; },
  });
  const hammer = createHammerOS({ plugins: [plugin] });
  const hired = await hammer.supervisor.hireByType("research", { id: "research-from-plugin" });
  const completed = await hammer.supervisor.assign(hired.id, { goal: "插件员工执行任务" });

  assert.equal(completed.result.employee, "research");
  assert.equal(hammer.pluginManager.get("research-employee-plugin").employees[0], ResearchEmployee);
  assert.equal(installedServices.supervisor, hammer.supervisor);
  assert.equal(installedServices.employeeRuntime, hammer.employeeRuntime);
  assert.equal(installedServices.knowledgeCenter, hammer.knowledgeCenter);
  await hammer.supervisor.retire(hired.id);
});

test("Employee Lifecycle 支持暂停、RESUME、恢复与回收并拒绝非法跳转", async () => {
  const illegal = new EmployeeLifecycle({ employeeId: "illegal" });
  assert.throws(() => illegal.transition(EMPLOYEE_STATE.FINISHED), /不允许 CREATED → FINISHED/);

  const hammer = createHammerOS();
  const hired = await hammer.supervisor.hire(ResearchEmployee, { id: "research-lifecycle" });
  assert.equal(hammer.supervisor.pause(hired.id).state, EMPLOYEE_STATE.SLEEPING);
  assert.equal(hammer.supervisor.resume(hired.id).state, EMPLOYEE_STATE.IDLE);
  const employee = hammer.employeeRuntime.get(hired.id);
  assert.ok(employee.lifecycle.history.some((entry) => entry.to === EMPLOYEE_STATE.RESUME));
  const retired = await hammer.supervisor.retire(hired.id);
  assert.equal(retired.state, EMPLOYEE_STATE.FINISHED);
  assert.equal(hammer.supervisor.employee(hired.id), null);
});

test("Supervisor 可协作式暂停正在工作的 Employee 并从 Checkpoint 恢复", async () => {
  let reachedCheckpoint;
  let continueToCheckpoint;
  const reached = new Promise((resolve) => { reachedCheckpoint = resolve; });
  const continueGate = new Promise((resolve) => { continueToCheckpoint = resolve; });
  class PausableEmployee extends BaseEmployee {
    static employeeType = "pausable";
    async execute() {
      this.reportProgress(45, "before-checkpoint");
      reachedCheckpoint();
      await continueGate;
      await this.checkpoint("mid-mission");
      return { resumed: true };
    }
  }

  const hammer = createHammerOS();
  const hired = await hammer.supervisor.hire(PausableEmployee, { id: "pausable-employee" });
  let completed = false;
  const mission = hammer.supervisor.assign(hired.id, { goal: "暂停并恢复" }).then((value) => {
    completed = true;
    return value;
  });
  await reached;
  assert.equal(hammer.supervisor.pause(hired.id).state, EMPLOYEE_STATE.SLEEPING);
  continueToCheckpoint();
  await wait(15);
  assert.equal(completed, false);
  assert.equal(hammer.supervisor.resume(hired.id).state, EMPLOYEE_STATE.WORKING);
  const result = await mission;
  assert.equal(result.result.resumed, true);
  assert.ok(hammer.employeeRuntime.get(hired.id).lifecycle.history.some((entry) => entry.to === EMPLOYEE_STATE.RESUME));
  await hammer.supervisor.retire(hired.id);
});

test("每个 Employee Workspace 隔离 Mission、Memory、History、Queue 与 Decision", async () => {
  const hammer = createHammerOS();
  const research = await hammer.supervisor.hire(ResearchEmployee, { id: "research-workspace" });
  const finance = await hammer.supervisor.hire(FinanceEmployee, { id: "finance-workspace" });
  const researchWorkspace = hammer.employeeRuntime.get(research.id).context.workspace;
  const financeWorkspace = hammer.employeeRuntime.get(finance.id).context.workspace;

  researchWorkspace.remember("private", "research-only");
  financeWorkspace.remember("private", "finance-only");
  researchWorkspace.addDecision({ decision: "CONTINUE" });

  assert.equal(researchWorkspace.recall("private"), "research-only");
  assert.equal(financeWorkspace.recall("private"), "finance-only");
  assert.equal(researchWorkspace.decision.length, 1);
  assert.equal(financeWorkspace.decision.length, 0);
  assert.notEqual(researchWorkspace, financeWorkspace);
  assert.deepEqual(Object.keys(hammer.employeeRuntime.get(research.id).context).sort(), ["communication", "knowledge", "workspace"]);
  assert.equal("runtime" in hammer.employeeRuntime.get(research.id).context, false);
  assert.equal("toolRegistry" in hammer.employeeRuntime.get(research.id).context, false);
  await hammer.supervisor.retire(research.id);
  await hammer.supervisor.retire(finance.id);
});

test("员工通过 Employee Message 请求协作，不能依赖另一个员工实例", async () => {
  class CoordinatingResearchEmployee extends BaseEmployee {
    static employeeType = "coordinating-research";

    async execute(mission) {
      this.reportProgress(30, "request-finance-review");
      const response = await this.request(mission.input.financeId, "PROFIT_REVIEW_REQUEST", { profit: 60 });
      return response.payload;
    }
  }

  const hammer = createHammerOS();
  const finance = await hammer.supervisor.hire(FinanceEmployee, { id: "finance-message" });
  const research = await hammer.supervisor.hire(CoordinatingResearchEmployee, { id: "research-message" });
  const completed = await hammer.supervisor.assign(research.id, { goal: "请求财务复核", input: { financeId: finance.id } });
  const lifecycle = hammer.employeeRuntime.get(research.id).lifecycle.history;

  assert.equal(completed.result.approved, true);
  assert.equal(completed.result.reviewedBy, finance.id);
  assert.ok(lifecycle.some((entry) => entry.to === EMPLOYEE_STATE.WAITING));
  assert.ok(hammer.employeeMessageBus.inbox(finance.id).some((message) => message.type === "PROFIT_REVIEW_REQUEST"));
  assert.ok(hammer.employeeMessageBus.inbox(research.id).some((message) => message.type === "PROFIT_REVIEW_COMPLETED"));
  await hammer.supervisor.retire(research.id);
  await hammer.supervisor.retire(finance.id);
});

test("Employee 每个心跳上报当前 Mission、进度、等待和 Need Help", async () => {
  let release;
  class HeartbeatEmployee extends BaseEmployee {
    static employeeType = "heartbeat-test";
    async execute() {
      this.reportProgress(55, "half-way");
      this.askForHelp("需要公开资料");
      await new Promise((resolve) => { release = resolve; });
      this.clearHelp();
      return { ok: true };
    }
  }

  const hammer = createHammerOS();
  const hired = await hammer.supervisor.hire(HeartbeatEmployee, { id: "heartbeat-employee", heartbeatIntervalMs: 10 });
  const completion = hammer.supervisor.assign(hired.id, { id: "mission-heartbeat", goal: "验证心跳" });
  await wait(35);
  const health = hammer.supervisor.employee(hired.id).health;

  assert.equal(health.health, "ONLINE");
  assert.equal(health.currentMission.id, "mission-heartbeat");
  assert.equal(health.progress, 55);
  assert.equal(health.needHelp, true);
  assert.equal(health.helpReason, "需要公开资料");
  release();
  await completion;
  await hammer.supervisor.retire(hired.id);
});

test("Heartbeat Monitor 识别卡住、等待过久、求助、失联和死亡", () => {
  let nowMs = Date.parse("2026-07-19T08:00:00.000Z");
  const now = () => new Date(nowMs);
  const monitor = new EmployeeHeartbeatMonitor({
    now,
    stuckAfterMs: 40,
    waitingTooLongAfterMs: 60,
    staleAfterMs: 50,
    deadAfterMs: 100,
  });
  const payload = {
    employeeId: "health-check-employee",
    employeeType: "research",
    name: "HealthCheckEmployee",
    state: EMPLOYEE_STATE.WORKING,
    currentMission: { id: "health-mission" },
    progress: 20,
    waiting: null,
    needHelp: false,
  };

  monitor.record(payload);
  nowMs += 41;
  monitor.record(payload);
  assert.equal(monitor.status(payload.employeeId).condition, EMPLOYEE_HEALTH_CONDITION.STUCK);

  monitor.record({ ...payload, progress: 30 });
  assert.equal(monitor.status(payload.employeeId).condition, EMPLOYEE_HEALTH_CONDITION.HEALTHY);

  monitor.record({ ...payload, state: EMPLOYEE_STATE.WAITING, waiting: "等待工具" });
  nowMs += 61;
  monitor.record({ ...payload, state: EMPLOYEE_STATE.WAITING, waiting: "等待工具" });
  assert.equal(monitor.status(payload.employeeId).condition, EMPLOYEE_HEALTH_CONDITION.WAITING_TOO_LONG);

  monitor.record({ ...payload, needHelp: true, helpReason: "需要 Supervisor 介入" });
  assert.equal(monitor.status(payload.employeeId).condition, EMPLOYEE_HEALTH_CONDITION.NEED_HELP);

  nowMs += 51;
  assert.equal(monitor.status(payload.employeeId).condition, EMPLOYEE_HEALTH_CONDITION.STALE);
  nowMs += 50;
  assert.equal(monitor.status(payload.employeeId).condition, EMPLOYEE_HEALTH_CONDITION.DEAD);
});

test("Supervisor Watchdog 自动开启、去重、持久化并关闭员工异常", async () => {
  let releaseMission;
  let missionStarted;
  let nowMs = Date.parse("2026-07-19T08:00:00.000Z");
  const now = () => new Date(nowMs);
  const started = new Promise((resolve) => { missionStarted = resolve; });
  class StalledEmployee extends BaseEmployee {
    static employeeType = "stalled-test";
    async execute() {
      this.reportProgress(25, "work-started");
      await this.heartbeat();
      missionStarted();
      await new Promise((resolve) => { releaseMission = resolve; });
      return { completed: true };
    }
  }

  const hammer = createHammerOS({
    employeeNow: now,
    employeeHealth: {
      stuckAfterMs: 40,
      waitingTooLongAfterMs: 80,
      staleAfterMs: 200,
      deadAfterMs: 400,
      autoStartWatchdog: false,
    },
  });
  const hired = await hammer.supervisor.hire(StalledEmployee, {
    id: "watchdog-stalled",
    now,
    heartbeatIntervalMs: 999_999,
  });
  const completion = hammer.supervisor.assign(hired.id, { id: "watchdog-mission", goal: "验证卡住识别" });
  await started;

  nowMs += 41;
  await hammer.employeeRuntime.get(hired.id).heartbeat();
  const openReport = await hammer.supervisor.inspectWorkforce();
  await hammer.employeeRuntime.get(hired.id).heartbeat();
  const openIncidents = await hammer.memoryService.list("employee.incidents");

  assert.equal(openReport.incidents.length, 1);
  assert.equal(openReport.incidents[0].condition, EMPLOYEE_HEALTH_CONDITION.STUCK);
  assert.equal(openReport.incidents[0].severity, "HIGH");
  assert.equal(openIncidents.length, 1);
  assert.equal(openIncidents[0].value.status, "OPEN");
  assert.ok(openIncidents[0].value.observations > 1);

  releaseMission();
  await completion;
  await hammer.employeeRuntime.get(hired.id).heartbeat();
  const recoveredReport = await hammer.supervisor.inspectWorkforce();
  const resolvedIncidents = await hammer.memoryService.list("employee.incidents");
  const roster = await hammer.memoryService.read("employee.roster", hired.id);

  assert.equal(recoveredReport.incidents.length, 0);
  assert.equal(resolvedIncidents.length, 1);
  assert.equal(resolvedIncidents[0].value.status, "RESOLVED");
  assert.equal(roster.healthIncident, null);
  await hammer.supervisor.retire(hired.id);
  hammer.supervisor.close();
});

test("Knowledge Center 让不同 Employee 共享规则且保留作者", async () => {
  class KnowledgeResearchEmployee extends BaseEmployee {
    static employeeType = "knowledge-research";
    async execute() {
      return this.context.knowledge.write("platform", "public-page-rule", { loginRequired: false }, { author: this.id, source: "public-rule-page" });
    }
  }
  class KnowledgeFinanceEmployee extends BaseEmployee {
    static employeeType = "knowledge-finance";
    async execute() {
      return this.context.knowledge.read("platform", "public-page-rule");
    }
  }

  const hammer = createHammerOS();
  const research = await hammer.supervisor.hire(KnowledgeResearchEmployee, { id: "research-knowledge" });
  const finance = await hammer.supervisor.hire(KnowledgeFinanceEmployee, { id: "finance-knowledge" });
  await hammer.supervisor.assign(research.id, { goal: "写入平台规则" });
  const read = await hammer.supervisor.assign(finance.id, { goal: "读取平台规则" });

  assert.equal(read.result.value.loginRequired, false);
  assert.equal(read.result.author, research.id);
  await hammer.supervisor.retire(research.id);
  await hammer.supervisor.retire(finance.id);
});

test("Hammer 重启后从 Roster 与 Workspace 恢复员工和未完成 Mission", async () => {
  class RecoverableEmployee extends BaseEmployee {
    static employeeType = "recoverable";
    async execute(mission) {
      this.context.workspace.remember("recovered-mission", mission.id);
      return { recovered: mission.id };
    }
  }
  const employeePlugin = () => definePlugin({
    manifest: { id: "recoverable-employee-plugin", version: "1.0.0" },
    employees: [RecoverableEmployee],
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), "hammer-employee-recovery-"));
  const memoryFile = path.join(directory, "memory.json");
  const first = createHammerOS({
    memoryAdapter: new JsonFileMemoryAdapter(memoryFile),
    plugins: [employeePlugin()],
  });
  const hired = await first.supervisor.hireByType("recoverable", { id: "recoverable-1" });
  const firstEmployee = first.employeeRuntime.get(hired.id);
  firstEmployee.context.workspace.remember("private-experience", { score: 88 });
  const interruptedMission = { id: "mission-before-restart", goal: "重启后继续", input: {}, priority: 0 };
  firstEmployee.context.workspace.setMission(interruptedMission);
  firstEmployee.lifecycle.transition(EMPLOYEE_STATE.WORKING, { reason: "simulate-process-crash" });
  await first.supervisor.persistEmployee(hired.id);
  await firstEmployee.context.workspace.flush();
  firstEmployee.stopHeartbeat();

  const second = createHammerOS({
    memoryAdapter: new JsonFileMemoryAdapter(memoryFile),
    plugins: [employeePlugin()],
  });
  const recovered = await second.supervisor.recover();
  await wait(20);
  const restoredEmployee = second.employeeRuntime.get(hired.id);

  assert.equal(recovered[0].status, "RECOVERED");
  assert.equal(restoredEmployee.context.workspace.recall("private-experience").score, 88);
  assert.equal(restoredEmployee.context.workspace.recall("recovered-mission"), "mission-before-restart");
  assert.equal(restoredEmployee.state, EMPLOYEE_STATE.IDLE);
  assert.ok(restoredEmployee.lifecycle.history.some((entry) => entry.reason === "process-restart-ready"));
  await second.supervisor.retire(hired.id);
});

test("恢复时缺少 Employee Plugin 会报告阻塞且不创建幽灵员工", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hammer-missing-employee-plugin-"));
  const memoryFile = path.join(directory, "memory.json");
  const first = createHammerOS({ memoryAdapter: new JsonFileMemoryAdapter(memoryFile) });
  const hired = await first.supervisor.hire(ResearchEmployee, { id: "research-needs-plugin" });
  await first.supervisor.persistEmployee(hired.id);
  first.employeeRuntime.get(hired.id).stopHeartbeat();

  const restarted = createHammerOS({ memoryAdapter: new JsonFileMemoryAdapter(memoryFile) });
  const recovery = await restarted.supervisor.recover();

  assert.deepEqual(recovery, [{
    id: hired.id,
    type: "research",
    status: "MISSING_EMPLOYEE_PLUGIN",
  }]);
  assert.equal(restarted.employeeRuntime.get(hired.id), null);
});

test("Employee 恢复失败时 Runtime 会回滚挂载", async () => {
  const hammer = createHammerOS();
  const snapshot = {
    lifecycle: {
      state: EMPLOYEE_STATE.FINISHED,
      history: [{ from: EMPLOYEE_STATE.IDLE, to: EMPLOYEE_STATE.FINISHED, reason: "already-retired" }],
    },
  };

  await assert.rejects(
    hammer.supervisor.hire(ResearchEmployee, {
      id: "invalid-restored-employee",
      restore: true,
      snapshot,
    }),
    /已结束，不能恢复/,
  );
  assert.equal(hammer.employeeRuntime.get("invalid-restored-employee"), null);
  assert.equal(hammer.employeeMessageBus.receivers.has("invalid-restored-employee"), false);
});

test("Employee Framework 源码不依赖 Commerce、Agent 或业务 Plugin", async () => {
  const files = [
    "core/base-employee.js",
    "core/employee-context.js",
    "core/employee-lifecycle.js",
    "runtime/employee-runtime.js",
    "supervisor/supervisor.js",
    "communication/employee-message-bus.js",
    "knowledge/knowledge-center.js",
    "workspace/employee-workspace.js",
  ];
  for (const file of files) {
    const source = await readFile(path.resolve("hammer-os/employees", file), "utf-8");
    assert.doesNotMatch(source, /commerce|agents\/|plugins\//i, `${file} 不应依赖业务或 Agent 层`);
  }
});
