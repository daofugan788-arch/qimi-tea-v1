import { IntentParser } from "./IntentParser.js";
import { ActionPlanner } from "./ActionPlanner.js";
import { ActionValidator } from "./ActionValidator.js";
import { ActionExecutor } from "./ActionExecutor.js";
import { ExecutionLogger } from "./ExecutionLogger.js";
import { automationRepository } from "./AutomationRepository.js";
import { AgentCore } from "../agent/AgentCore.js";
import { AgentExecutor } from "../agent/AgentExecutor.js";
import { AgentPlanner } from "../agent/AgentPlanner.js";
import { IntentRouter } from "../agent/IntentRouter.js";
import { TaskQueue } from "../agent/TaskQueue.js";
import { ActionStatus, TaskStatus, isTerminalTaskStatus } from "../agent/Task.js";

export class AutomationEngine {
  constructor({ parser, planner, validator, executor, logger, agentCore, agentExecutor, intentRouter, agentPlanner, taskQueue, repository = automationRepository } = {}) {
    this.parser = parser || new IntentParser();
    this.planner = planner || new ActionPlanner();
    this.validator = validator || new ActionValidator();
    this.repository = repository;
    this.executor = executor || new ActionExecutor({ repository });
    this.logger = logger || new ExecutionLogger(repository);
    this.agentCore = agentCore || new AgentCore();
    this.activeController = null;
    this.activeTaskId = null;
    this.agentExecutor = agentExecutor || new AgentExecutor({
      getTask: (taskId) => this.getTask(taskId),
    });
    if (!this.agentExecutor.hasTool("automation")) {
      this.agentExecutor.registerTool(
        "automation",
        (task, context) => this.execute(task.id, context),
        {
          type: "local_automation",
          description: "执行已通过现有安全校验的本地自动化任务",
          paramsSchema: {},
          enabled: true,
          riskLevel: "LOW",
        },
      );
    }
    this.intentRouter = intentRouter || new IntentRouter({
      agentCore: this.agentCore,
      executor: this.agentExecutor,
      taskFactory: (route) => route.toolName === "automation" ? this.createTask(route.rawText) : null,
    });
    this.taskQueue = taskQueue || new TaskQueue({
      getTask: (taskId) => this.getTask(taskId),
      runTask: async (taskId, options) => {
        const routed = await this.intentRouter.executeTask(taskId, options);
        return routed.execution || routed;
      },
      cancelTask: (taskId, reason) => this.cancelPreview(taskId, reason),
    });
    this.agentPlanner = agentPlanner || new AgentPlanner({
      intentRouter: this.intentRouter,
      taskQueue: this.taskQueue,
      executor: this.agentExecutor,
    });
  }

  recognizeIntent(input) {
    return this.intentRouter.recognize(input);
  }

  createIntentTask(input, options) {
    return this.intentRouter.createTask(input, options);
  }

  dispatchIntent(input, options) {
    return this.intentRouter.dispatch(input, options);
  }

  dispatchIntentTask(taskId, options) {
    return this.intentRouter.executeTask(taskId, options);
  }

  createExecutionPlan(input, options) {
    return this.agentPlanner.createPlan(input, options);
  }

  getExecutionPlan(planId) {
    return this.agentPlanner.getPlan(planId);
  }

  executeExecutionPlan(planId, options) {
    return this.agentPlanner.executePlan(planId, options);
  }

  createTask(input) {
    const parsed = this.parser.parse(input);
    const validation = this.validator.validatePlan(this.planner.plan(parsed));
    const actions = validation.results.map((item) => item.action);
    const task = this.agentCore.createTask({
      kind: "automation",
      input: String(input || "").trim(),
      parsed,
      actions,
      riskLevel: validation.highestRisk,
      requiresConfirmation: validation.requiresConfirmation,
      status: validation.blocked ? TaskStatus.BLOCKED : validation.requiresConfirmation ? TaskStatus.WAITING_CONFIRMATION : TaskStatus.PENDING,
      error: validation.blocked ? actions.flatMap((item) => item.validationErrors || []).join("；") : "",
      metadata: { source: parsed.source || "local_rule" },
    });
    this.logger.startTask(task);
    return task;
  }

  getTask(taskId) {
    return this.agentCore.getTask(taskId);
  }

  enqueueTask(taskId, options) {
    return this.taskQueue.enqueue(taskId, options);
  }

  runTaskQueue() {
    return this.taskQueue.start();
  }

  getTaskQueueSnapshot() {
    return this.taskQueue.getSnapshot();
  }

  cancelQueuedTask(taskId) {
    return this.taskQueue.cancelPending(taskId);
  }

  subscribeTaskQueue(listener) {
    return this.taskQueue.subscribe(listener);
  }

  getTaskExecution(taskId) {
    return this.agentExecutor.getExecution(taskId);
  }

  subscribeTaskExecution(listener) {
    return this.agentExecutor.subscribe(listener);
  }

  async execute(taskId, { confirmed = false } = {}) {
    const task = this.agentCore.getMutableTask(taskId);
    if (!task) throw new Error("任务不存在或已经失效");
    if (task.status === TaskStatus.BLOCKED) throw new Error(task.error || "任务已被安全策略阻止");
    if (task.requiresConfirmation && !confirmed) {
      const error = new Error("此任务包含 MEDIUM 风险动作，需要手动确认");
      error.code = "CONFIRMATION_REQUIRED";
      throw error;
    }

    if (task.actions.some((item) => item.type === "cancel_task")) {
      const stopped = this.cancelCurrentTask(task.id);
      const action = task.actions[0];
      this.agentCore.transitionTask(task.id, TaskStatus.RUNNING);
      this.agentCore.transitionAction(task.id, action.id, ActionStatus.RUNNING);
      this.agentCore.transitionAction(task.id, action.id, ActionStatus.COMPLETED);
      this.logger.updateStep(task.id, action, { result: { message: stopped ? "当前任务已停止" : "当前没有运行中的任务" }, finishedAt: new Date().toISOString() });
      this.agentCore.transitionTask(task.id, TaskStatus.COMPLETED);
      this.logger.updateTask(task.id, TaskStatus.COMPLETED);
      return this.getTask(task.id);
    }

    if (this.activeTaskId && this.activeTaskId !== task.id) throw new Error("已有任务正在执行，请先停止当前任务");
    const controller = new AbortController();
    this.activeController = controller;
    this.activeTaskId = task.id;
    if (task.status !== TaskStatus.RUNNING) this.agentCore.transitionTask(task.id, TaskStatus.RUNNING);
    this.logger.updateTask(task.id, TaskStatus.RUNNING);

    try {
      for (const current of task.actions) {
        if (controller.signal.aborted) throw new DOMException("任务已取消", "AbortError");
        const checked = this.validator.validate(current);
        const currentStatus = current.status;
        Object.assign(current, checked.action, { status: currentStatus });
        if (checked.blocked) {
          this.agentCore.transitionAction(task.id, current.id, ActionStatus.BLOCKED, { error: checked.errors.join("；") });
          this.logger.updateStep(task.id, current, { error: checked.errors.join("；"), finishedAt: current.finishedAt });
          throw new Error(checked.errors.join("；") || "动作被安全策略阻止");
        }
        this.agentCore.transitionAction(task.id, current.id, ActionStatus.RUNNING);
        this.logger.updateStep(task.id, current, { startedAt: current.startedAt });
        const result = await this.executor.execute(current, { signal: controller.signal });
        this.agentCore.transitionAction(task.id, current.id, result.status, { error: [ActionStatus.BLOCKED, ActionStatus.FAILED].includes(result.status) ? result.message : "" });
        this.logger.updateStep(task.id, current, { result, error: current.error, finishedAt: current.finishedAt });
        if ([ActionStatus.BLOCKED, ActionStatus.FAILED].includes(result.status)) throw new Error(result.message || "动作执行失败");
      }
      this.agentCore.transitionTask(task.id, TaskStatus.COMPLETED);
      this.logger.updateTask(task.id, TaskStatus.COMPLETED);
      return this.getTask(task.id);
    } catch (error) {
      const cancelled = error?.name === "AbortError";
      const taskError = error?.message || "任务执行失败";
      if (cancelled) {
        this.agentCore.cancelTask(task.id, taskError);
        task.actions.filter((item) => item.status === ActionStatus.CANCELLED).forEach((item) => {
          this.logger.updateStep(task.id, item, { error: item.error, finishedAt: item.finishedAt });
        });
        this.logger.updateTask(task.id, TaskStatus.CANCELLED, taskError);
        return this.getTask(task.id);
      }
      const running = task.actions.find((item) => item.status === ActionStatus.RUNNING);
      if (running) {
        this.agentCore.transitionAction(task.id, running.id, ActionStatus.FAILED, { error: taskError });
        this.logger.updateStep(task.id, running, { error: taskError, finishedAt: running.finishedAt });
      }
      this.agentCore.transitionTask(task.id, TaskStatus.FAILED, { error: taskError });
      this.logger.updateTask(task.id, TaskStatus.FAILED, taskError);
      throw error;
    } finally {
      if (this.activeTaskId === task.id) {
        this.activeController = null;
        this.activeTaskId = null;
      }
    }
  }

  cancelCurrentTask(exceptTaskId = null) {
    if (!this.activeController || this.activeController.signal.aborted || this.activeTaskId === exceptTaskId) return false;
    this.activeController.abort();
    return true;
  }

  cancelPreview(taskId, reason = "用户取消了任务") {
    const task = this.agentCore.getMutableTask(taskId);
    if (!task || isTerminalTaskStatus(task.status)) return false;
    const changed = this.agentCore.cancelTask(taskId, reason);
    if (!changed) return false;
    task.actions.filter((item) => item.status === ActionStatus.CANCELLED).forEach((item) => {
      this.logger.updateStep(taskId, item, { error: item.error, finishedAt: item.finishedAt });
    });
    this.logger.updateTask(taskId, TaskStatus.CANCELLED, reason);
    return true;
  }

  getTemplates() {
    return this.planner.getTemplates();
  }

  getHistory() {
    return this.logger.getHistory();
  }
}
