// Agent Core 的统一任务数据结构。保持纯 JSON，便于日志、导出与后续迁移。
export const TASK_SCHEMA_VERSION = 1;

export const TaskStatus = Object.freeze({
  PENDING: "pending",
  WAITING_CONFIRMATION: "waiting_confirmation",
  RUNNING: "running",
  COMPLETED: "completed",
  BLOCKED: "blocked",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const ActionStatus = Object.freeze({
  PENDING: "pending",
  WAITING_CONFIRMATION: "waiting_confirmation",
  RUNNING: "running",
  COMPLETED: "completed",
  EXTERNAL_REQUIRED: "external_required",
  BLOCKED: "blocked",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const TERMINAL_TASK_STATUSES = new Set([
  TaskStatus.COMPLETED,
  TaskStatus.BLOCKED,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
]);

export const TERMINAL_ACTION_STATUSES = new Set([
  ActionStatus.COMPLETED,
  ActionStatus.EXTERNAL_REQUIRED,
  ActionStatus.BLOCKED,
  ActionStatus.FAILED,
  ActionStatus.CANCELLED,
]);

const TASK_STATUS_VALUES = new Set(Object.values(TaskStatus));
const ACTION_STATUS_VALUES = new Set(Object.values(ActionStatus));

function createId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function cloneTask(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isTerminalTaskStatus(status) {
  return TERMINAL_TASK_STATUSES.has(status);
}

export function isTerminalActionStatus(status) {
  return TERMINAL_ACTION_STATUSES.has(status);
}

export function assertTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error("Task 必须是对象");
  if (!String(task.id || "").startsWith("task-")) throw new Error("Task id 无效");
  if (task.schemaVersion !== TASK_SCHEMA_VERSION) throw new Error("Task 数据版本不受支持");
  if (!TASK_STATUS_VALUES.has(task.status)) throw new Error("Task status 无效");
  if (!Array.isArray(task.actions)) throw new Error("Task actions 必须是数组");
  if (!task.parsed || typeof task.parsed !== "object" || Array.isArray(task.parsed)) throw new Error("Task parsed 无效");

  const actionIds = new Set();
  for (const action of task.actions) {
    if (!action || typeof action !== "object" || Array.isArray(action)) throw new Error("Task action 必须是对象");
    if (!String(action.id || "").startsWith("action-")) throw new Error("Task action id 无效");
    if (actionIds.has(action.id)) throw new Error("Task action id 不能重复");
    if (!ACTION_STATUS_VALUES.has(action.status)) throw new Error("Task action status 无效");
    actionIds.add(action.id);
  }
  return true;
}

export function createTask({
  id = createId("task"),
  kind = "automation",
  input = "",
  parsed,
  actions = [],
  riskLevel = "LOW",
  requiresConfirmation = false,
  status = TaskStatus.PENDING,
  error = "",
  metadata = {},
  createdAt = new Date().toISOString(),
} = {}) {
  const task = {
    schemaVersion: TASK_SCHEMA_VERSION,
    id,
    kind: String(kind || "automation"),
    input: String(input || "").trim(),
    parsed: cloneTask(parsed || {}),
    actions: cloneTask(Array.isArray(actions) ? actions : []),
    riskLevel: String(riskLevel || "LOW"),
    requiresConfirmation: Boolean(requiresConfirmation),
    status,
    error: String(error || ""),
    metadata: cloneTask(metadata || {}),
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: isTerminalTaskStatus(status) ? createdAt : null,
  };
  assertTask(task);
  return task;
}
