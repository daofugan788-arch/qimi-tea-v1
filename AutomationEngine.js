import { IntentParser } from "./IntentParser.js";
import { ActionPlanner } from "./ActionPlanner.js";
import { ActionValidator } from "./ActionValidator.js";
import { ActionExecutor } from "./ActionExecutor.js";
import { ExecutionLogger } from "./ExecutionLogger.js";
import { automationRepository } from "./AutomationRepository.js";

function createId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

export class AutomationEngine {
  constructor({ parser, planner, validator, executor, logger, repository = automationRepository } = {}) {
    this.parser = parser || new IntentParser();
    this.planner = planner || new ActionPlanner();
    this.validator = validator || new ActionValidator();
    this.repository = repository;
    this.executor = executor || new ActionExecutor({ repository });
    this.logger = logger || new ExecutionLogger(repository);
    this.tasks = new Map();
    this.activeController = null;
    this.activeTaskId = null;
  }

  createTask(input) {
    const parsed = this.parser.parse(input);
    const validation = this.validator.validatePlan(this.planner.plan(parsed));
    const actions = validation.results.map((item) => item.action);
    const task = {
      id: createId("task"),
      input: String(input || "").trim(),
      parsed,
      actions,
      riskLevel: validation.highestRisk,
      requiresConfirmation: validation.requiresConfirmation,
      status: validation.blocked ? "blocked" : validation.requiresConfirmation ? "waiting_confirmation" : "pending",
      error: validation.blocked ? actions.flatMap((item) => item.validationErrors || []).join("；") : "",
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);
    this.logger.startTask(task);
    return snapshot(task);
  }

  getTask(taskId) {
    const task = this.tasks.get(taskId);
    return task ? snapshot(task) : null;
  }

  async execute(taskId, { confirmed = false } = {}) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("任务不存在或已经失效");
    if (task.status === "blocked") throw new Error(task.error || "任务已被安全策略阻止");
    if (task.requiresConfirmation && !confirmed) {
      const error = new Error("此任务包含 MEDIUM 风险动作，需要手动确认");
      error.code = "CONFIRMATION_REQUIRED";
      throw error;
    }

    if (task.actions.some((item) => item.type === "cancel_task")) {
      const stopped = this.cancelCurrentTask(task.id);
      const action = task.actions[0];
      action.status = "completed";
      this.logger.updateStep(task.id, action, { result: { message: stopped ? "当前任务已停止" : "当前没有运行中的任务" }, finishedAt: new Date().toISOString() });
      task.status = "completed";
      this.logger.updateTask(task.id, "completed");
      return snapshot(task);
    }

    if (this.activeTaskId && this.activeTaskId !== task.id) throw new Error("已有任务正在执行，请先停止当前任务");
    const controller = new AbortController();
    this.activeController = controller;
    this.activeTaskId = task.id;
    task.status = "running";
    this.logger.updateTask(task.id, "running");

    try {
      for (const current of task.actions) {
        if (controller.signal.aborted) throw new DOMException("任务已取消", "AbortError");
        const checked = this.validator.validate(current);
        Object.assign(current, checked.action);
        if (checked.blocked) throw new Error(checked.errors.join("；") || "动作被安全策略阻止");
        current.status = "running";
        const startedAt = new Date().toISOString();
        this.logger.updateStep(task.id, current, { startedAt });
        const result = await this.executor.execute(current, { signal: controller.signal });
        current.status = result.status;
        this.logger.updateStep(task.id, current, { result, finishedAt: new Date().toISOString() });
        if (result.status === "blocked" || result.status === "failed") throw new Error(result.message || "动作执行失败");
      }
      task.status = "completed";
      this.logger.updateTask(task.id, "completed");
      return snapshot(task);
    } catch (error) {
      const cancelled = error?.name === "AbortError";
      task.status = cancelled ? "cancelled" : "failed";
      task.error = error?.message || "任务执行失败";
      const running = task.actions.find((item) => item.status === "running");
      if (running) {
        running.status = task.status;
        this.logger.updateStep(task.id, running, { error: task.error, finishedAt: new Date().toISOString() });
      }
      this.logger.updateTask(task.id, task.status, task.error);
      if (!cancelled) throw error;
      return snapshot(task);
    } finally {
      if (this.activeTaskId === task.id) {
        this.activeController = null;
        this.activeTaskId = null;
      }
    }
  }

  cancelCurrentTask(exceptTaskId = null) {
    if (!this.activeController || this.activeTaskId === exceptTaskId) return false;
    this.activeController.abort();
    return true;
  }

  cancelPreview(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || ["completed", "cancelled"].includes(task.status)) return false;
    task.status = "cancelled";
    task.actions.filter((item) => ["pending", "waiting_confirmation"].includes(item.status)).forEach((item) => { item.status = "cancelled"; });
    this.logger.updateTask(taskId, "cancelled", "用户取消了任务");
    return true;
  }

  getTemplates() {
    return this.planner.getTemplates();
  }

  getHistory() {
    return this.logger.getHistory();
  }
}

