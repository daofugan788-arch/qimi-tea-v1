import { assertStep, cloneStepData } from "./Step.js";

export const EXECUTION_PLAN_SCHEMA_VERSION = 1;

export const ExecutionPlanStatus = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  WAITING_CONFIRMATION: "waiting_confirmation",
  SUCCESS: "success",
  FAILED: "failed",
  BLOCKED: "blocked",
  EXTERNAL_REQUIRED: "external_required",
  CANCELLED: "cancelled",
});

export const TERMINAL_EXECUTION_PLAN_STATUSES = new Set([
  ExecutionPlanStatus.SUCCESS,
  ExecutionPlanStatus.FAILED,
  ExecutionPlanStatus.BLOCKED,
  ExecutionPlanStatus.EXTERNAL_REQUIRED,
  ExecutionPlanStatus.CANCELLED,
]);

const PLAN_STATUS_VALUES = new Set(Object.values(ExecutionPlanStatus));

const PLAN_TRANSITIONS = Object.freeze({
  [ExecutionPlanStatus.PENDING]: new Set([
    ExecutionPlanStatus.RUNNING,
    ExecutionPlanStatus.BLOCKED,
    ExecutionPlanStatus.CANCELLED,
  ]),
  [ExecutionPlanStatus.RUNNING]: new Set([
    ExecutionPlanStatus.WAITING_CONFIRMATION,
    ExecutionPlanStatus.SUCCESS,
    ExecutionPlanStatus.FAILED,
    ExecutionPlanStatus.BLOCKED,
    ExecutionPlanStatus.EXTERNAL_REQUIRED,
    ExecutionPlanStatus.CANCELLED,
  ]),
  [ExecutionPlanStatus.WAITING_CONFIRMATION]: new Set([
    ExecutionPlanStatus.RUNNING,
    ExecutionPlanStatus.BLOCKED,
    ExecutionPlanStatus.CANCELLED,
  ]),
  [ExecutionPlanStatus.SUCCESS]: new Set(),
  [ExecutionPlanStatus.FAILED]: new Set(),
  [ExecutionPlanStatus.BLOCKED]: new Set(),
  [ExecutionPlanStatus.EXTERNAL_REQUIRED]: new Set(),
  [ExecutionPlanStatus.CANCELLED]: new Set(),
});

function createId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function assertDependencies(steps) {
  const stepIds = new Set(steps.map((step) => step.id));
  for (const step of steps) {
    for (const dependencyId of step.dependsOn) {
      if (!stepIds.has(dependencyId)) throw new Error(`Step ${step.id} 依赖的 ${dependencyId} 不存在`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(steps.map((step) => [step.id, step]));
  function visit(stepId) {
    if (visited.has(stepId)) return;
    if (visiting.has(stepId)) throw new Error("Execution Plan 存在循环依赖");
    visiting.add(stepId);
    for (const dependencyId of byId.get(stepId).dependsOn) visit(dependencyId);
    visiting.delete(stepId);
    visited.add(stepId);
  }
  for (const step of steps) visit(step.id);
}

export function cloneExecutionPlan(value) {
  return cloneStepData(value);
}

export function isTerminalExecutionPlanStatus(status) {
  return TERMINAL_EXECUTION_PLAN_STATUSES.has(status);
}

export function assertExecutionPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("Execution Plan 必须是对象");
  if (!String(plan.id || "").startsWith("plan-")) throw new Error("Execution Plan id 无效");
  if (plan.schemaVersion !== EXECUTION_PLAN_SCHEMA_VERSION) throw new Error("Execution Plan 数据版本不受支持");
  if (!PLAN_STATUS_VALUES.has(plan.status)) throw new Error("Execution Plan status 无效");
  if (!Array.isArray(plan.steps)) throw new Error("Execution Plan steps 必须是数组");
  const stepIds = new Set();
  for (const step of plan.steps) {
    assertStep(step);
    if (stepIds.has(step.id)) throw new Error("Execution Plan Step id 不能重复");
    stepIds.add(step.id);
  }
  assertDependencies(plan.steps);
  return true;
}

export function createExecutionPlan({
  id = createId("plan"),
  input = "",
  intent = "unknown",
  steps = [],
  riskLevel = "LOW",
  status = ExecutionPlanStatus.PENDING,
  error = "",
  metadata = {},
  createdAt = new Date().toISOString(),
} = {}) {
  const plan = {
    schemaVersion: EXECUTION_PLAN_SCHEMA_VERSION,
    id,
    input: String(input || "").trim(),
    intent: String(intent || "unknown"),
    steps: cloneExecutionPlan(steps),
    riskLevel: String(riskLevel || "LOW").toUpperCase(),
    status,
    error: String(error || ""),
    metadata: cloneExecutionPlan(metadata || {}),
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: isTerminalExecutionPlanStatus(status) ? createdAt : null,
  };
  assertExecutionPlan(plan);
  return plan;
}

export function transitionExecutionPlan(plan, nextStatus, { error } = {}) {
  assertExecutionPlan(plan);
  if (!PLAN_STATUS_VALUES.has(nextStatus)) throw new Error(`不支持的 Execution Plan 状态：${nextStatus}`);
  if (plan.status !== nextStatus && !PLAN_TRANSITIONS[plan.status]?.has(nextStatus)) {
    throw new Error(`Execution Plan 状态不能从 ${plan.status} 变更为 ${nextStatus}`);
  }
  const now = new Date().toISOString();
  plan.status = nextStatus;
  plan.updatedAt = now;
  if (nextStatus === ExecutionPlanStatus.RUNNING && !plan.startedAt) plan.startedAt = now;
  if (isTerminalExecutionPlanStatus(nextStatus)) plan.finishedAt = now;
  if (error !== undefined) plan.error = String(error || "");
  return cloneExecutionPlan(plan);
}

export { PLAN_TRANSITIONS };
