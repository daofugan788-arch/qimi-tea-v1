import assert from "node:assert/strict";
import { AgentCore } from "../js/agent/AgentCore.js";
import { AgentExecutor } from "../js/agent/AgentExecutor.js";
import { AgentPlanner } from "../js/agent/AgentPlanner.js";
import {
  ExecutionPlanStatus,
  assertExecutionPlan,
  createExecutionPlan,
} from "../js/agent/ExecutionPlan.js";
import { IntentRouter } from "../js/agent/IntentRouter.js";
import { StepExecutionMode, StepStatus, createStep } from "../js/agent/Step.js";
import { TaskQueue } from "../js/agent/TaskQueue.js";
import { AutomationEngine } from "../js/automation/AutomationEngine.js";
import { AutomationRepository } from "../js/automation/AutomationRepository.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.get(key) || null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}

// Step 数据结构、依赖合法性和循环依赖检查。
const firstSchemaStep = createStep({ id: "step-schema-1", name: "第一步", input: "打开设置" });
const secondSchemaStep = createStep({
  id: "step-schema-2",
  name: "第二步",
  input: "打开聊天",
  dependsOn: [firstSchemaStep.id],
});
const schemaPlan = createExecutionPlan({
  id: "plan-schema",
  input: "先打开设置再打开聊天",
  intent: "schema_test",
  steps: [firstSchemaStep, secondSchemaStep],
});
assert.equal(assertExecutionPlan(schemaPlan), true);
assert.deepEqual(schemaPlan.steps[1].dependsOn, [schemaPlan.steps[0].id]);

const cycleA = createStep({ id: "step-cycle-a", name: "循环A", input: "A", dependsOn: ["step-cycle-b"] });
const cycleB = createStep({ id: "step-cycle-b", name: "循环B", input: "B", dependsOn: ["step-cycle-a"] });
assert.throws(
  () => createExecutionPlan({ id: "plan-cycle", input: "循环", steps: [cycleA, cycleB] }),
  /循环依赖/,
);

// 真实现有链路：Planner -> IntentRouter -> AgentCore Task -> TaskQueue -> Executor -> automation Tool。
const repository = new AutomationRepository({
  storage: new MemoryStorage(),
  key: "test.agent.planner",
});
const actionOrder = [];
const automation = new AutomationEngine({
  repository,
  executor: {
    async execute(action) {
      actionOrder.push(action.type);
      return { status: "completed", message: "测试动作完成" };
    },
  },
});

const multiStepPlan = automation.createExecutionPlan("检查并重启暮曦");
assert.equal(multiStepPlan.intent, "check_then_restart_muxi");
assert.equal(multiStepPlan.steps.length, 2);
assert.deepEqual(multiStepPlan.steps[1].dependsOn, [multiStepPlan.steps[0].id]);
assert.equal(multiStepPlan.steps[0].status, StepStatus.PENDING);
assert.equal(multiStepPlan.steps[1].status, StepStatus.PENDING);

const successfulPlan = await automation.executeExecutionPlan(multiStepPlan.id, { confirmed: true });
assert.equal(successfulPlan.status, ExecutionPlanStatus.SUCCESS);
assert.deepEqual(successfulPlan.steps.map((step) => step.status), [StepStatus.SUCCESS, StepStatus.SUCCESS]);
assert.ok(successfulPlan.steps.every((step) => step.taskId?.startsWith("task-")));
assert.ok(actionOrder.length >= 2);

// MEDIUM 步骤未确认时暂停，确认后从原计划继续。
const confirmationPlan = automation.createExecutionPlan("检查并重启暮曦");
const waitingPlan = await automation.executeExecutionPlan(confirmationPlan.id);
assert.equal(waitingPlan.status, ExecutionPlanStatus.WAITING_CONFIRMATION);
assert.equal(waitingPlan.steps[0].status, StepStatus.WAITING_CONFIRMATION);
assert.equal(waitingPlan.steps[1].status, StepStatus.PENDING);
const resumedPlan = await automation.executeExecutionPlan(confirmationPlan.id, { confirmed: true });
assert.equal(resumedPlan.status, ExecutionPlanStatus.SUCCESS);
assert.deepEqual(resumedPlan.steps.map((step) => step.status), [StepStatus.SUCCESS, StepStatus.SUCCESS]);

// 单意图没有专用规划规则时，自动生成一个可执行 Step。
const fallbackPlan = automation.createExecutionPlan("打开设置");
assert.equal(fallbackPlan.steps.length, 1);
assert.equal(fallbackPlan.steps[0].toolName, "automation");
const fallbackResult = await automation.executeExecutionPlan(fallbackPlan.id);
assert.equal(fallbackResult.status, ExecutionPlanStatus.SUCCESS);

// 自定义失败链路：第二步失败后，第三步必须跳过且 Tool 不得被调用。
const failureCore = new AgentCore();
const failureExecutor = new AgentExecutor({ getTask: (taskId) => failureCore.getTask(taskId) });
const calls = [];
failureExecutor.registerTool("step_one", () => {
  calls.push("step_one");
  return { status: "success" };
});
failureExecutor.registerTool("step_fail", () => {
  calls.push("step_fail");
  throw new Error("模拟第二步失败");
});
failureExecutor.registerTool("step_never", () => {
  calls.push("step_never");
  return { status: "success" };
});
const failureRouter = new IntentRouter({
  agentCore: failureCore,
  executor: failureExecutor,
  useDefaultRules: false,
  rules: [
    { id: "route-one", intent: "one", toolName: "step_one", patterns: [/^执行第一步$/] },
    { id: "route-fail", intent: "fail", toolName: "step_fail", patterns: [/^执行失败步骤$/] },
    { id: "route-never", intent: "never", toolName: "step_never", patterns: [/^执行第三步$/] },
  ],
});
const failureQueue = new TaskQueue({
  getTask: (taskId) => failureCore.getTask(taskId),
  runTask: async (taskId, options) => {
    const routed = await failureRouter.executeTask(taskId, options);
    return routed.execution || routed;
  },
});
const failurePlanner = new AgentPlanner({
  intentRouter: failureRouter,
  taskQueue: failureQueue,
  executor: failureExecutor,
  useDefaultRules: false,
  rules: [{
    id: "plan-failure-test",
    intent: "failure_stop_test",
    patterns: [/^运行失败停止测试$/],
    buildSteps: () => [
      { key: "one", name: "第一步成功", input: "执行第一步" },
      { key: "fail", name: "第二步失败", input: "执行失败步骤", dependsOn: ["one"] },
      { key: "never", name: "第三步不应执行", input: "执行第三步", dependsOn: ["fail"] },
    ],
  }],
});
const failurePlan = failurePlanner.createPlan("运行失败停止测试");
const failedResult = await failurePlanner.executePlan(failurePlan.id);
assert.equal(failedResult.status, ExecutionPlanStatus.FAILED);
assert.deepEqual(failedResult.steps.map((step) => step.status), [
  StepStatus.SUCCESS,
  StepStatus.FAILED,
  StepStatus.SKIPPED,
]);
assert.deepEqual(calls, ["step_one", "step_fail"]);

// 用户案例：只输出安全计划；PWA 不读取、移动或删除 Android 下载目录。
const organizePlan = automation.createExecutionPlan("帮我整理下载目录");
assert.equal(organizePlan.intent, "organize_downloads");
assert.equal(organizePlan.steps.length, 3);
assert.ok(organizePlan.steps.every((step) => step.executionMode === StepExecutionMode.EXTERNAL_REQUIRED));
assert.deepEqual(organizePlan.steps[1].dependsOn, [organizePlan.steps[0].id]);
assert.deepEqual(organizePlan.steps[2].dependsOn, [organizePlan.steps[1].id]);
assert.ok(organizePlan.steps.every((step) => step.taskId === null));
const organizeResult = await automation.executeExecutionPlan(organizePlan.id);
assert.equal(organizeResult.status, ExecutionPlanStatus.EXTERNAL_REQUIRED);
assert.ok(organizeResult.steps.every((step) => step.status === StepStatus.EXTERNAL_REQUIRED));
assert.ok(organizeResult.steps.every((step) => step.taskId === null));

console.log(JSON.stringify({
  stepSchema: "passed",
  dependencyValidation: "passed",
  cycleDetection: "passed",
  multiStepPlanning: "passed",
  successContinues: "passed",
  confirmationResume: "passed",
  failureStops: "passed",
  skippedToolWasNotCalled: !calls.includes("step_never"),
  integrations: ["IntentRouter", "AgentCore", "TaskQueue", "AgentExecutor"],
  remoteModelUsed: false,
  realCase: {
    input: organizePlan.input,
    planStatus: organizePlan.status,
    executionResult: organizeResult.status,
    steps: organizePlan.steps.map((step, index) => ({
      order: index + 1,
      name: step.name,
      dependsOnPrevious: index === 0 ? false : step.dependsOn.includes(organizePlan.steps[index - 1].id),
      executionMode: step.executionMode,
      description: step.description,
    })),
  },
}, null, 2));
