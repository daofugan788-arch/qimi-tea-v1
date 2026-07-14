import { ToolRegistry, ToolRiskLevel } from "../tools/ToolRegistry.js";
import { assertToolContract } from "../tools/Tool.js";

export const ExecutorStatus = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  CANCELLED: "cancelled",
  SUCCESS: "success",
  FAILED: "failed",
});

function createId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function cloneValue(value) {
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

function toolResultFailed(result) {
  return ["failed", "blocked"].includes(String(result?.status || "").toLowerCase());
}

function toolResultCancelled(result) {
  return String(result?.status || "").toLowerCase() === ExecutorStatus.CANCELLED;
}

// 任务级执行器：按 Task.kind 选择工具，并统一记录 pending/running/cancelled/success/failed。
export class AgentExecutor {
  constructor({ getTask, tools = {}, toolRegistry } = {}) {
    if (typeof getTask !== "function") throw new Error("AgentExecutor 需要 getTask 函数");
    this.getTask = getTask;
    this.toolRegistry = toolRegistry || new ToolRegistry();
    this.executions = new Map();
    this.listeners = new Set();

    for (const [taskType, tool] of Object.entries(tools)) this.registerTool(taskType, tool);
  }

  registerTool(taskType, tool, metadata = {}) {
    const normalizedType = String(taskType || "").trim();
    if (!normalizedType) throw new Error("任务类型不能为空");
    const toolObject = tool && typeof tool === "object" && typeof tool.execute === "function" ? tool : null;
    if (toolObject) {
      try {
        assertToolContract(toolObject);
        if (toolObject.name !== normalizedType) throw new Error(`Tool.name 必须与任务类型 ${normalizedType} 一致`);
        this.toolRegistry.register(toolObject);
        if (metadata.enabled !== undefined) this.toolRegistry.setEnabled(normalizedType, metadata.enabled);
        if (metadata.riskLevel) this.toolRegistry.setRiskLevel(normalizedType, metadata.riskLevel);
        return this;
      } catch (error) {
        if (toolObject.paramsSchema || toolObject.validate || toolObject.cancel) throw error;
      }
    }
    const execute = typeof tool === "function"
      ? tool
      : toolObject
        ? (task, context) => toolObject.execute(task, context)
        : null;
    if (!execute) throw new Error("Executor 工具必须是函数或包含 execute 方法的对象");
    this.toolRegistry.register({
      name: normalizedType,
      type: metadata.type || toolObject?.type || "local",
      description: metadata.description || toolObject?.description || "",
      paramsSchema: metadata.paramsSchema || metadata.parameters || toolObject?.paramsSchema || toolObject?.parameters || {},
      validate: metadata.validate || toolObject?.validate,
      enabled: metadata.enabled ?? toolObject?.enabled ?? true,
      riskLevel: metadata.riskLevel || toolObject?.riskLevel || ToolRiskLevel.LOW,
      execute,
      cancel: metadata.cancel || toolObject?.cancel,
    });
    return this;
  }

  unregisterTool(taskType) {
    return this.toolRegistry.unregister(taskType);
  }

  hasTool(taskType) {
    return this.toolRegistry.has(taskType);
  }

  getToolTypes() {
    return this.toolRegistry.list().map((tool) => tool.name);
  }

  getTools() {
    return this.toolRegistry.list();
  }

  async cancelExecution(taskId, context = {}) {
    const task = this.getTask(String(taskId || "").trim());
    if (!task) return { cancelled: false, error: "任务不存在或已经失效" };
    if (!this.toolRegistry.has(task.kind)) return { cancelled: false, error: `工具 ${task.kind} 未注册` };
    return this.toolRegistry.cancel(task.kind, { ...context, taskId: task.id });
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new Error("Executor 监听器必须是函数");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    const safeEvent = cloneValue(event);
    for (const listener of this.listeners) {
      try {
        listener(safeEvent);
      } catch {
        // 状态监听器不能中断任务执行。
      }
    }
  }

  getExecution(taskId) {
    const execution = this.executions.get(taskId);
    return execution ? cloneValue(execution) : null;
  }

  getExecutions() {
    return [...this.executions.values()].map((item) => cloneValue(item));
  }

  setStatus(execution, status, { output, error } = {}) {
    const previousStatus = execution.status;
    const now = new Date().toISOString();
    execution.status = status;
    execution.updatedAt = now;
    if (status === ExecutorStatus.RUNNING && !execution.startedAt) execution.startedAt = now;
    if ([ExecutorStatus.CANCELLED, ExecutorStatus.SUCCESS, ExecutorStatus.FAILED].includes(status)) {
      execution.finishedAt = now;
    }
    if (output !== undefined) execution.output = cloneValue(output);
    if (error !== undefined) execution.error = String(error || "");
    this.emit({
      type: "executor_status_changed",
      executionId: execution.id,
      taskId: execution.taskId,
      taskType: execution.taskType,
      previousStatus,
      status,
      error: execution.error,
      at: now,
    });
    return cloneValue(execution);
  }

  async executeTask(taskId, context = {}) {
    const normalizedTaskId = String(taskId || "").trim();
    const task = this.getTask(normalizedTaskId);
    const taskType = String(task?.kind || "unknown");
    const now = new Date().toISOString();
    const execution = {
      id: createId("execution"),
      taskId: normalizedTaskId,
      taskType,
      status: ExecutorStatus.PENDING,
      output: null,
      error: "",
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    };
    this.executions.set(normalizedTaskId, execution);
    this.emit({
      type: "executor_status_changed",
      executionId: execution.id,
      taskId: normalizedTaskId,
      taskType,
      previousStatus: null,
      status: ExecutorStatus.PENDING,
      error: "",
      at: now,
    });

    if (!task) return this.setStatus(execution, ExecutorStatus.FAILED, { error: "任务不存在或已经失效" });

    this.setStatus(execution, ExecutorStatus.RUNNING);
    const normalizedContext = context && typeof context === "object" ? context : {};
    const params = normalizedContext.params || task.metadata?.toolParams || task.params || {};
    const permission = this.toolRegistry.checkPermission(taskType, {
      confirmed: Boolean(normalizedContext.confirmed),
      params,
    });
    if (!permission.allowed) {
      return this.setStatus(execution, ExecutorStatus.FAILED, {
        output: { permission },
        error: permission.message,
      });
    }

    try {
      const output = await this.toolRegistry.execute(taskType, cloneValue(task), {
        ...normalizedContext,
        params,
      });
      if (toolResultCancelled(output)) {
        return this.setStatus(execution, ExecutorStatus.CANCELLED, {
          output,
          error: output?.error || "任务已取消",
        });
      }
      if (toolResultFailed(output)) {
        return this.setStatus(execution, ExecutorStatus.FAILED, {
          output,
          error: output?.error || `任务返回状态 ${output.status}`,
        });
      }
      return this.setStatus(execution, ExecutorStatus.SUCCESS, { output, error: "" });
    } catch (error) {
      if (error?.name === "AbortError") {
        return this.setStatus(execution, ExecutorStatus.CANCELLED, {
          error: error?.message || "任务已取消",
        });
      }
      return this.setStatus(execution, ExecutorStatus.FAILED, {
        error: error?.message || "任务执行失败",
      });
    }
  }

  executeFromQueue(taskId, context) {
    return this.executeTask(taskId, context);
  }
}
