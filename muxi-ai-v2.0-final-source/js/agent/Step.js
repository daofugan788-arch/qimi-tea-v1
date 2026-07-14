export const STEP_SCHEMA_VERSION = 1;

export const StepExecutionMode = Object.freeze({
  TOOL: "tool",
  EXTERNAL_REQUIRED: "external_required",
});

export const StepStatus = Object.freeze({
  PENDING: "pending",
  WAITING_DEPENDENCY: "waiting_dependency",
  WAITING_CONFIRMATION: "waiting_confirmation",
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
  BLOCKED: "blocked",
  EXTERNAL_REQUIRED: "external_required",
  SKIPPED: "skipped",
  CANCELLED: "cancelled",
});

export const TERMINAL_STEP_STATUSES = new Set([
  StepStatus.SUCCESS,
  StepStatus.FAILED,
  StepStatus.BLOCKED,
  StepStatus.EXTERNAL_REQUIRED,
  StepStatus.SKIPPED,
  StepStatus.CANCELLED,
]);

export const SATISFIED_DEPENDENCY_STATUSES = new Set([
  StepStatus.SUCCESS,
  StepStatus.EXTERNAL_REQUIRED,
]);

const STEP_STATUS_VALUES = new Set(Object.values(StepStatus));
const EXECUTION_MODE_VALUES = new Set(Object.values(StepExecutionMode));
const RISK_LEVEL_VALUES = new Set(["LOW", "MEDIUM", "HIGH"]);

const STEP_TRANSITIONS = Object.freeze({
  [StepStatus.PENDING]: new Set([
    StepStatus.WAITING_DEPENDENCY,
    StepStatus.WAITING_CONFIRMATION,
    StepStatus.RUNNING,
    StepStatus.FAILED,
    StepStatus.BLOCKED,
    StepStatus.EXTERNAL_REQUIRED,
    StepStatus.SKIPPED,
    StepStatus.CANCELLED,
  ]),
  [StepStatus.WAITING_DEPENDENCY]: new Set([
    StepStatus.WAITING_CONFIRMATION,
    StepStatus.RUNNING,
    StepStatus.FAILED,
    StepStatus.BLOCKED,
    StepStatus.EXTERNAL_REQUIRED,
    StepStatus.SKIPPED,
    StepStatus.CANCELLED,
  ]),
  [StepStatus.WAITING_CONFIRMATION]: new Set([
    StepStatus.RUNNING,
    StepStatus.FAILED,
    StepStatus.BLOCKED,
    StepStatus.SKIPPED,
    StepStatus.CANCELLED,
  ]),
  [StepStatus.RUNNING]: new Set([
    StepStatus.SUCCESS,
    StepStatus.FAILED,
    StepStatus.BLOCKED,
    StepStatus.EXTERNAL_REQUIRED,
    StepStatus.CANCELLED,
  ]),
  [StepStatus.SUCCESS]: new Set(),
  [StepStatus.FAILED]: new Set(),
  [StepStatus.BLOCKED]: new Set(),
  [StepStatus.EXTERNAL_REQUIRED]: new Set(),
  [StepStatus.SKIPPED]: new Set(),
  [StepStatus.CANCELLED]: new Set(),
});

function createId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function cloneStepData(value) {
  if (value === undefined) return null;
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(value);
    } catch {
      // 不能结构化复制时回退到 JSON 数据。
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function isTerminalStepStatus(status) {
  return TERMINAL_STEP_STATUSES.has(status);
}

export function isSatisfiedDependencyStatus(status) {
  return SATISFIED_DEPENDENCY_STATUSES.has(status);
}

export function assertStep(step) {
  if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error("Step 必须是对象");
  if (!String(step.id || "").startsWith("step-")) throw new Error("Step id 无效");
  if (step.schemaVersion !== STEP_SCHEMA_VERSION) throw new Error("Step 数据版本不受支持");
  if (!String(step.name || "").trim()) throw new Error("Step name 不能为空");
  if (!STEP_STATUS_VALUES.has(step.status)) throw new Error("Step status 无效");
  if (!EXECUTION_MODE_VALUES.has(step.executionMode)) throw new Error("Step executionMode 无效");
  if (!RISK_LEVEL_VALUES.has(step.riskLevel)) throw new Error("Step riskLevel 无效");
  if (!Array.isArray(step.dependsOn)) throw new Error("Step dependsOn 必须是数组");
  if (new Set(step.dependsOn).size !== step.dependsOn.length) throw new Error("Step dependsOn 不能重复");
  if (step.dependsOn.includes(step.id)) throw new Error("Step 不能依赖自身");
  if (!step.params || typeof step.params !== "object" || Array.isArray(step.params)) throw new Error("Step params 必须是对象");
  if (step.executionMode === StepExecutionMode.TOOL && !String(step.input || "").trim()) {
    throw new Error("Tool Step 必须包含 input");
  }
  return true;
}

export function createStep({
  id = createId("step"),
  name,
  description = "",
  input = "",
  intent = "",
  toolName = "",
  params = {},
  dependsOn = [],
  executionMode = StepExecutionMode.TOOL,
  riskLevel = "LOW",
  requiresConfirmation = false,
  stopOnFailure = true,
  status = StepStatus.PENDING,
  taskId = null,
  result = null,
  error = "",
  metadata = {},
  createdAt = new Date().toISOString(),
} = {}) {
  const step = {
    schemaVersion: STEP_SCHEMA_VERSION,
    id,
    name: String(name || "").trim(),
    description: String(description || ""),
    input: String(input || "").trim(),
    intent: String(intent || ""),
    toolName: String(toolName || ""),
    params: cloneStepData(params || {}),
    dependsOn: [...new Set(dependsOn.map((item) => String(item || "").trim()).filter(Boolean))],
    executionMode,
    riskLevel: String(riskLevel || "LOW").toUpperCase(),
    requiresConfirmation: Boolean(requiresConfirmation),
    stopOnFailure: stopOnFailure !== false,
    status,
    taskId: taskId ? String(taskId) : null,
    result: cloneStepData(result),
    error: String(error || ""),
    metadata: cloneStepData(metadata || {}),
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: isTerminalStepStatus(status) ? createdAt : null,
  };
  assertStep(step);
  return step;
}

export function transitionStep(step, nextStatus, { result, error, taskId } = {}) {
  assertStep(step);
  if (!STEP_STATUS_VALUES.has(nextStatus)) throw new Error(`不支持的 Step 状态：${nextStatus}`);
  if (step.status !== nextStatus && !STEP_TRANSITIONS[step.status]?.has(nextStatus)) {
    throw new Error(`Step 状态不能从 ${step.status} 变更为 ${nextStatus}`);
  }

  const now = new Date().toISOString();
  step.status = nextStatus;
  step.updatedAt = now;
  if (nextStatus === StepStatus.RUNNING && !step.startedAt) step.startedAt = now;
  if (isTerminalStepStatus(nextStatus)) step.finishedAt = now;
  if (result !== undefined) step.result = cloneStepData(result);
  if (error !== undefined) step.error = String(error || "");
  if (taskId !== undefined) step.taskId = taskId ? String(taskId) : null;
  return cloneStepData(step);
}

export { STEP_TRANSITIONS };
