import {
  ExecutionPlanStatus,
  cloneExecutionPlan,
  createExecutionPlan,
  isTerminalExecutionPlanStatus,
  transitionExecutionPlan,
} from "./ExecutionPlan.js";
import {
  StepExecutionMode,
  StepStatus,
  createStep,
  isSatisfiedDependencyStatus,
  isTerminalStepStatus,
  transitionStep,
} from "./Step.js";
import { ExecutorStatus } from "./AgentExecutor.js";
import { TaskStatus } from "./Task.js";
import { ToolRiskLevel } from "../tools/Tool.js";

const RISK_WEIGHT = Object.freeze({ LOW: 1, MEDIUM: 2, HIGH: 3 });

export const PlannerRuleSource = Object.freeze({
  DEFAULT_RULE: "default_rule",
  CUSTOM_RULE: "custom_rule",
  INTENT_FALLBACK: "intent_fallback",
});

export const DEFAULT_PLANNER_RULES = Object.freeze([
  {
    id: "plan-organize-downloads-safely",
    intent: "organize_downloads",
    description: "只生成下载目录整理预览，不读取、移动或删除手机文件",
    priority: 100,
    patterns: [/(?:帮我|请)?整理(?:一下)?(?:手机)?下载目录/i, /整理.*download/i],
    buildSteps: () => [
      {
        key: "inspect",
        name: "获取下载目录文件清单",
        description: "当前 PWA 无权读取 Android 下载目录，需要未来外部执行器提供文件清单。",
        executionMode: StepExecutionMode.EXTERNAL_REQUIRED,
        riskLevel: ToolRiskLevel.MEDIUM,
      },
      {
        key: "classify",
        name: "生成分类整理预览",
        description: "按图片、文档、压缩包等类别生成预览，不移动、不覆盖、不删除文件。",
        executionMode: StepExecutionMode.EXTERNAL_REQUIRED,
        riskLevel: ToolRiskLevel.MEDIUM,
        dependsOn: ["inspect"],
      },
      {
        key: "confirm",
        name: "等待用户确认文件变更",
        description: "涉及移动或删除文件时必须逐项确认；当前版本不执行任何文件变更。",
        executionMode: StepExecutionMode.EXTERNAL_REQUIRED,
        riskLevel: ToolRiskLevel.HIGH,
        requiresConfirmation: true,
        dependsOn: ["classify"],
      },
    ],
  },
  {
    id: "plan-check-then-restart-muxi",
    intent: "check_then_restart_muxi",
    description: "先检查暮曦服务，成功后再生成重启步骤",
    priority: 90,
    patterns: [/(?:帮我|请)?(?:先)?检查.*(?:然后|再|并).*重(?:新)?启暮曦/i, /检查并重启暮曦/i],
    buildSteps: () => [
      {
        key: "check",
        name: "检查暮曦服务",
        input: "检查暮曦服务",
      },
      {
        key: "restart",
        name: "重启暮曦",
        input: "重启暮曦",
        dependsOn: ["check"],
      },
    ],
  },
]);

function createId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function normalizeInput(input) {
  return String(input || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizePatterns(patterns) {
  if (!Array.isArray(patterns) || !patterns.length) throw new Error("Planner 规则至少需要一个 pattern");
  return patterns.map((pattern) => pattern instanceof RegExp ? pattern : new RegExp(String(pattern), "i"));
}

function normalizeRule(definition, source, order) {
  const id = String(definition?.id || "").trim();
  const intent = String(definition?.intent || "").trim();
  if (!id) throw new Error("Planner 规则缺少 id");
  if (!intent) throw new Error(`Planner 规则 ${id} 缺少 intent`);
  if (typeof definition.buildSteps !== "function") throw new Error(`Planner 规则 ${id} 缺少 buildSteps()`);
  return {
    id,
    intent,
    description: String(definition.description || ""),
    priority: Number.isFinite(Number(definition.priority)) ? Number(definition.priority) : 0,
    patterns: normalizePatterns(definition.patterns),
    buildSteps: definition.buildSteps,
    source,
    order,
  };
}

function publicRule(rule) {
  return {
    id: rule.id,
    intent: rule.intent,
    description: rule.description,
    priority: rule.priority,
    patterns: rule.patterns.map((pattern) => ({ source: pattern.source, flags: pattern.flags })),
    source: rule.source,
  };
}

function highestRisk(steps) {
  return steps.reduce((highest, step) => {
    return (RISK_WEIGHT[step.riskLevel] || 0) > (RISK_WEIGHT[highest] || 0) ? step.riskLevel : highest;
  }, ToolRiskLevel.LOW);
}

function taskSucceeded(status) {
  return [ExecutorStatus.SUCCESS, TaskStatus.COMPLETED, StepStatus.SUCCESS].includes(status);
}

// 本地 Agent Planner V1：规则拆解、依赖调度和失败停止，不调用任何远程模型。
export class AgentPlanner {
  constructor({ intentRouter, taskQueue, executor, rules = [], useDefaultRules = true } = {}) {
    if (!intentRouter || typeof intentRouter.recognize !== "function" || typeof intentRouter.createTask !== "function") {
      throw new Error("AgentPlanner 需要 IntentRouter 实例");
    }
    if (!taskQueue || typeof taskQueue.enqueue !== "function" || typeof taskQueue.start !== "function") {
      throw new Error("AgentPlanner 需要 TaskQueue 实例");
    }
    if (!executor || typeof executor.getTools !== "function" || typeof executor.getExecution !== "function") {
      throw new Error("AgentPlanner 需要 AgentExecutor 实例");
    }
    this.intentRouter = intentRouter;
    this.taskQueue = taskQueue;
    this.executor = executor;
    this.rules = new Map();
    this.plans = new Map();
    this.nextOrder = 0;

    if (useDefaultRules) {
      for (const rule of DEFAULT_PLANNER_RULES) this.registerRule(rule, PlannerRuleSource.DEFAULT_RULE);
    }
    for (const rule of rules) this.registerRule(rule, PlannerRuleSource.CUSTOM_RULE);
  }

  registerRule(definition, source = PlannerRuleSource.CUSTOM_RULE) {
    const normalizedSource = source === PlannerRuleSource.DEFAULT_RULE
      ? PlannerRuleSource.DEFAULT_RULE
      : PlannerRuleSource.CUSTOM_RULE;
    const rule = normalizeRule(definition, normalizedSource, this.nextOrder++);
    if (this.rules.has(rule.id)) throw new Error(`Planner 规则 ${rule.id} 已存在`);
    this.rules.set(rule.id, rule);
    return publicRule(rule);
  }

  unregisterRule(ruleId) {
    return this.rules.delete(String(ruleId || "").trim());
  }

  getRules() {
    return this.getSortedRules().map((rule) => publicRule(rule));
  }

  getSortedRules() {
    return [...this.rules.values()].sort((left, right) => right.priority - left.priority || left.order - right.order);
  }

  matchRule(input) {
    for (const rule of this.getSortedRules()) {
      for (const pattern of rule.patterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(input);
        pattern.lastIndex = 0;
        if (match) return { rule, match };
      }
    }
    return null;
  }

  materializeSteps(rawSteps, input) {
    if (!Array.isArray(rawSteps) || !rawSteps.length) throw new Error("Planner 规则必须生成至少一个 Step");
    const stepIds = new Map();
    for (const item of rawSteps) {
      const key = String(item.key || "").trim();
      if (!key) throw new Error("Planner Step 缺少 key");
      if (stepIds.has(key)) throw new Error(`Planner Step key ${key} 重复`);
      stepIds.set(key, createId("step"));
    }

    return rawSteps.map((item) => {
      const mode = item.executionMode || StepExecutionMode.TOOL;
      const stepInput = normalizeInput(item.input || input);
      const route = mode === StepExecutionMode.TOOL ? this.intentRouter.recognize(stepInput) : null;
      const tool = route?.matched
        ? this.executor.getTools().find((candidate) => candidate.name === route.toolName) || null
        : null;
      const blocked = mode === StepExecutionMode.TOOL && (!route?.matched || !tool);
      const riskLevel = String(item.riskLevel || tool?.riskLevel || ToolRiskLevel.LOW).toUpperCase();
      return createStep({
        id: stepIds.get(item.key),
        name: item.name,
        description: item.description || "",
        input: stepInput,
        intent: item.intent || route?.intent || "external_required",
        toolName: item.toolName || route?.toolName || "",
        params: item.params || route?.params || {},
        dependsOn: (item.dependsOn || []).map((key) => {
          if (!stepIds.has(key)) throw new Error(`Planner Step ${item.key} 依赖的 key ${key} 不存在`);
          return stepIds.get(key);
        }),
        executionMode: mode,
        riskLevel,
        requiresConfirmation: item.requiresConfirmation ?? riskLevel === ToolRiskLevel.MEDIUM,
        stopOnFailure: item.stopOnFailure !== false,
        status: blocked ? StepStatus.BLOCKED : StepStatus.PENDING,
        error: blocked ? "没有找到可执行此步骤的本地 Intent 或 Tool" : "",
        metadata: { sourceKey: item.key },
      });
    });
  }

  createPlan(input, { metadata = {} } = {}) {
    const normalizedInput = normalizeInput(input);
    const matched = this.matchRule(normalizedInput);
    let intent = "unknown";
    let source = PlannerRuleSource.INTENT_FALLBACK;
    let ruleId = null;
    let rawSteps = [];

    if (matched) {
      intent = matched.rule.intent;
      source = matched.rule.source;
      ruleId = matched.rule.id;
      rawSteps = matched.rule.buildSteps({
        input: normalizedInput,
        match: matched.match,
        metadata: cloneExecutionPlan(metadata || {}),
      });
    } else {
      const route = this.intentRouter.recognize(normalizedInput);
      if (route.matched) {
        intent = route.intent;
        rawSteps = [{ key: "single", name: route.intent, input: normalizedInput }];
      }
    }

    if (!rawSteps.length) {
      const blockedPlan = createExecutionPlan({
        input: normalizedInput,
        intent,
        steps: [],
        status: ExecutionPlanStatus.BLOCKED,
        error: "当前本地规则无法生成执行计划",
        metadata: { ...metadata, source, ruleId },
      });
      this.plans.set(blockedPlan.id, blockedPlan);
      return cloneExecutionPlan(blockedPlan);
    }

    const steps = this.materializeSteps(rawSteps, normalizedInput);
    const blocked = steps.some((step) => step.status === StepStatus.BLOCKED);
    const plan = createExecutionPlan({
      input: normalizedInput,
      intent,
      steps,
      riskLevel: highestRisk(steps),
      status: blocked ? ExecutionPlanStatus.BLOCKED : ExecutionPlanStatus.PENDING,
      error: blocked ? steps.filter((step) => step.error).map((step) => step.error).join("；") : "",
      metadata: { ...metadata, source, ruleId },
    });
    this.plans.set(plan.id, plan);
    return cloneExecutionPlan(plan);
  }

  getPlan(planId) {
    const plan = this.plans.get(String(planId || "").trim());
    return plan ? cloneExecutionPlan(plan) : null;
  }

  getPlans() {
    return [...this.plans.values()].map((plan) => cloneExecutionPlan(plan));
  }

  skipRemainingSteps(plan, failedStep, reason) {
    for (const step of plan.steps) {
      if (step.id === failedStep.id || isTerminalStepStatus(step.status)) continue;
      transitionStep(step, StepStatus.SKIPPED, { error: reason });
    }
  }

  failPlan(plan, failedStep, status = ExecutionPlanStatus.FAILED) {
    const reason = failedStep.error || `步骤 ${failedStep.name} 执行失败，后续步骤已停止`;
    this.skipRemainingSteps(plan, failedStep, reason);
    transitionExecutionPlan(plan, status, { error: reason });
    return cloneExecutionPlan(plan);
  }

  getStepTask(step) {
    return step.taskId ? this.intentRouter.agentCore.getTask(step.taskId) : null;
  }

  ensureStepTask(step, plan) {
    const existing = this.getStepTask(step);
    if (existing) return existing;
    const created = this.intentRouter.createTask(step.input, {
      metadata: { executionPlanId: plan.id, executionStepId: step.id },
      params: step.params,
    });
    if (!created.task) throw new Error(`步骤 ${step.name} 无法创建 Task`);
    step.taskId = created.task.id;
    step.requiresConfirmation = step.requiresConfirmation || created.task.requiresConfirmation;
    step.riskLevel = (RISK_WEIGHT[created.task.riskLevel] || 0) > (RISK_WEIGHT[step.riskLevel] || 0)
      ? created.task.riskLevel
      : step.riskLevel;
    step.updatedAt = new Date().toISOString();
    return created.task;
  }

  async runToolStep(plan, step, confirmedStepIds, confirmedAll) {
    let task;
    try {
      task = this.ensureStepTask(step, plan);
    } catch (error) {
      transitionStep(step, StepStatus.FAILED, { error: error?.message || "创建 Task 失败" });
      return false;
    }

    if (task.status === TaskStatus.BLOCKED) {
      transitionStep(step, StepStatus.BLOCKED, { taskId: task.id, error: task.error || "任务已被安全策略阻止" });
      return false;
    }

    const confirmed = confirmedAll || confirmedStepIds.has(step.id);
    if (step.requiresConfirmation && !confirmed) {
      transitionStep(step, StepStatus.WAITING_CONFIRMATION, { taskId: task.id });
      transitionExecutionPlan(plan, ExecutionPlanStatus.WAITING_CONFIRMATION);
      return null;
    }

    transitionStep(step, StepStatus.RUNNING, { taskId: task.id, error: "" });
    try {
      this.taskQueue.enqueue(task.id, { confirmed });
      const summary = await this.taskQueue.start();
      const queueResult = summary.results.find((item) => item.taskId === task.id);
      const execution = this.executor.getExecution(task.id);
      const status = execution?.status || queueResult?.status;
      if (status === ExecutorStatus.CANCELLED || status === TaskStatus.CANCELLED) {
        transitionStep(step, StepStatus.CANCELLED, {
          taskId: task.id,
          result: execution?.output ?? queueResult ?? null,
          error: execution?.error || queueResult?.error || "步骤已取消",
        });
        return false;
      }
      if (taskSucceeded(status)) {
        transitionStep(step, StepStatus.SUCCESS, {
          taskId: task.id,
          result: execution?.output ?? queueResult ?? null,
          error: "",
        });
        return true;
      }
      transitionStep(step, StepStatus.FAILED, {
        taskId: task.id,
        result: execution?.output ?? queueResult ?? null,
        error: execution?.error || queueResult?.error || "步骤执行失败",
      });
      return false;
    } catch (error) {
      const cancelled = error?.name === "AbortError";
      transitionStep(step, cancelled ? StepStatus.CANCELLED : StepStatus.FAILED, {
        taskId: task.id,
        error: error?.message || (cancelled ? "步骤已取消" : "步骤执行失败"),
      });
      return false;
    }
  }

  async executePlan(planId, { confirmed = false, confirmedStepIds = [] } = {}) {
    const plan = this.plans.get(String(planId || "").trim());
    if (!plan) throw new Error("Execution Plan 不存在或已经失效");
    if (isTerminalExecutionPlanStatus(plan.status)) return cloneExecutionPlan(plan);

    transitionExecutionPlan(plan, ExecutionPlanStatus.RUNNING, { error: "" });
    const confirmationSet = new Set(confirmedStepIds.map((item) => String(item)));

    while (true) {
      const pendingSteps = plan.steps.filter((step) => !isTerminalStepStatus(step.status));
      if (!pendingSteps.length) break;
      let progressed = false;

      for (const step of pendingSteps) {
        const dependencies = step.dependsOn.map((id) => plan.steps.find((candidate) => candidate.id === id));
        const failedDependency = dependencies.find((dependency) => !dependency || [
          StepStatus.FAILED,
          StepStatus.BLOCKED,
          StepStatus.SKIPPED,
          StepStatus.CANCELLED,
        ].includes(dependency.status));
        if (failedDependency) {
          transitionStep(step, StepStatus.SKIPPED, { error: `依赖步骤 ${failedDependency?.name || "未知"} 未成功` });
          progressed = true;
          continue;
        }
        if (!dependencies.every((dependency) => isSatisfiedDependencyStatus(dependency.status))) {
          if (step.status === StepStatus.PENDING) transitionStep(step, StepStatus.WAITING_DEPENDENCY);
          continue;
        }

        if (step.executionMode === StepExecutionMode.EXTERNAL_REQUIRED) {
          transitionStep(step, StepStatus.EXTERNAL_REQUIRED, {
            result: { message: step.description, requiresExternalExecutor: true },
          });
          progressed = true;
          continue;
        }

        const succeeded = await this.runToolStep(plan, step, confirmationSet, Boolean(confirmed));
        if (succeeded === null) return cloneExecutionPlan(plan);
        progressed = true;
        if (!succeeded && step.stopOnFailure) {
          if (step.status === StepStatus.CANCELLED) {
            const reason = step.error || `步骤 ${step.name} 已取消`;
            this.skipRemainingSteps(plan, step, reason);
            transitionExecutionPlan(plan, ExecutionPlanStatus.CANCELLED, { error: reason });
            return cloneExecutionPlan(plan);
          }
          const blocked = step.status === StepStatus.BLOCKED;
          return this.failPlan(plan, step, blocked ? ExecutionPlanStatus.BLOCKED : ExecutionPlanStatus.FAILED);
        }
      }

      if (!progressed) {
        const stuck = pendingSteps[0];
        transitionStep(stuck, StepStatus.FAILED, { error: "步骤依赖无法继续执行" });
        return this.failPlan(plan, stuck);
      }
    }

    if (plan.steps.some((step) => step.status === StepStatus.CANCELLED)) {
      transitionExecutionPlan(plan, ExecutionPlanStatus.CANCELLED, { error: "一个或多个步骤已取消" });
    } else if (plan.steps.some((step) => step.status === StepStatus.FAILED)) {
      transitionExecutionPlan(plan, ExecutionPlanStatus.FAILED, { error: "一个或多个步骤执行失败" });
    } else if (plan.steps.some((step) => step.status === StepStatus.BLOCKED)) {
      transitionExecutionPlan(plan, ExecutionPlanStatus.BLOCKED, { error: "一个或多个步骤被安全策略阻止" });
    } else if (plan.steps.some((step) => step.status === StepStatus.EXTERNAL_REQUIRED)) {
      transitionExecutionPlan(plan, ExecutionPlanStatus.EXTERNAL_REQUIRED);
    } else {
      transitionExecutionPlan(plan, ExecutionPlanStatus.SUCCESS);
    }
    return cloneExecutionPlan(plan);
  }
}
