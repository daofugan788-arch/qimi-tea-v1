import { CHAIN_STATUS, CHAIN_STEP_STATUS, TOOL_OUTCOME } from "./chain-status.js";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ChainExecutor {
  constructor({ store, registry, stepDelay = 260 } = {}) {
    this.store = store;
    this.registry = registry;
    this.stepDelay = stepDelay;
  }

  async run(chain, onUpdate = () => {}) {
    let current = this.store.update(chain.id, {
      status: CHAIN_STATUS.RUNNING,
      blocked: null,
      startedAt: chain.startedAt || new Date().toISOString(),
    });
    onUpdate(current);
    let guard = 0;

    try {
      while (current.currentStepIndex < current.steps.length) {
        guard += 1;
        if (guard > 100) throw new Error("任务链超过最大自动推进次数");
        const step = current.steps[current.currentStepIndex];
        const runningSteps = current.steps.map((item, index) => (
          index === current.currentStepIndex ? { ...item, status: CHAIN_STEP_STATUS.RUNNING, error: null } : item
        ));
        current = this.store.update(current.id, { steps: runningSteps, status: CHAIN_STATUS.RUNNING });
        onUpdate(current);
        if (this.stepDelay > 0) await wait(this.stepDelay);

        const runtime = { chain: current };
        const result = await this.registry.execute(step.tool, { goal: current.goal }, runtime);
        if (!result?.outcome) throw new Error(`工具 ${step.tool} 没有返回任务链结果`);

        if (result.outcome === TOOL_OUTCOME.BLOCKED) {
          const blockedSteps = current.steps.map((item, index) => (
            index === current.currentStepIndex
              ? { ...item, status: CHAIN_STEP_STATUS.BLOCKED, output: result.data || null }
              : item
          ));
          current = this.store.update(current.id, {
            status: CHAIN_STATUS.BLOCKED,
            steps: blockedSteps,
            blocked: {
              stepId: step.id,
              tool: step.tool,
              actionType: result.actionType,
              reason: result.reason,
              data: result.data || null,
              blockedAt: new Date().toISOString(),
            },
          });
          onUpdate(current);
          return current;
        }

        if (result.outcome === TOOL_OUTCOME.RETRY) {
          const rejected = result.data?.product;
          const nextContext = {
            ...current.context,
            attemptedProductIds: rejected
              ? [...new Set([...(current.context.attemptedProductIds || []), rejected.id])]
              : current.context.attemptedProductIds,
            attempts: [...(current.context.attempts || []), {
              productId: rejected?.id,
              productName: rejected?.name,
              reason: result.data?.reason || "未达到条件",
              at: new Date().toISOString(),
            }],
            outputs: {
              ...current.context.outputs,
              "chain.product.discover": null,
              "chain.profit.screen": null,
            },
          };
          const retrySteps = current.steps.map((item, index) => (
            index <= 1
              ? { ...item, status: CHAIN_STEP_STATUS.WAITING, output: null, error: null }
              : item
          ));
          current = this.store.update(current.id, {
            context: nextContext,
            steps: retrySteps,
            currentStepIndex: Number(result.resetToStep) || 0,
          });
          onUpdate(current);
          continue;
        }

        const nextContext = {
          ...current.context,
          outputs: { ...current.context.outputs, [step.tool]: result.data },
        };
        const completedSteps = current.steps.map((item, index) => (
          index === current.currentStepIndex
            ? { ...item, status: CHAIN_STEP_STATUS.SUCCESS, output: result.data }
            : item
        ));
        current = this.store.update(current.id, {
          context: nextContext,
          steps: completedSteps,
          currentStepIndex: current.currentStepIndex + 1,
        });
        onUpdate(current);
      }

      current = this.store.update(current.id, {
        status: CHAIN_STATUS.SUCCESS,
        result: current.context.outputs["chain.daily.report"] || null,
        completedAt: new Date().toISOString(),
      });
      onUpdate(current);
      return current;
    } catch (error) {
      const failedSteps = current.steps.map((item, index) => (
        index === current.currentStepIndex
          ? { ...item, status: CHAIN_STEP_STATUS.FAILED, error: error?.message || "执行失败" }
          : item
      ));
      current = this.store.update(current.id, {
        status: CHAIN_STATUS.FAILED,
        steps: failedSteps,
        error: error?.message || "任务链执行失败",
        completedAt: new Date().toISOString(),
      });
      onUpdate(current);
      return current;
    }
  }

  async resume(chainId, signals = {}, onUpdate = () => {}) {
    const chain = this.store.get(chainId);
    if (!chain) throw new Error("找不到需要恢复的任务链");
    if (chain.status !== CHAIN_STATUS.BLOCKED && chain.status !== CHAIN_STATUS.PAUSED) {
      throw new Error("当前任务链不在等待恢复状态");
    }
    const steps = chain.steps.map((step, index) => (
      index === chain.currentStepIndex && step.status === CHAIN_STEP_STATUS.BLOCKED
        ? { ...step, status: CHAIN_STEP_STATUS.WAITING }
        : step
    ));
    const updated = this.store.update(chain.id, {
      steps,
      blocked: null,
      context: {
        ...chain.context,
        signals: { ...(chain.context.signals || {}), ...signals },
      },
    });
    return this.run(updated, onUpdate);
  }
}
