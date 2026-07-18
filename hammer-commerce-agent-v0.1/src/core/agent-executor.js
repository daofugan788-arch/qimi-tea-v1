import { STEP_STATUS, TASK_STATUS } from "./task-status.js";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class AgentExecutor {
  constructor({ store, registry, stepDelay = 260 } = {}) {
    this.store = store;
    this.registry = registry;
    this.stepDelay = stepDelay;
  }

  async run(task, plan, onUpdate = () => {}) {
    let current = this.store.update(task.id, {
      status: TASK_STATUS.RUNNING,
      steps: plan,
      startedAt: new Date().toISOString(),
    });
    onUpdate(current);
    const context = { task: current, outputs: {} };

    try {
      for (const step of current.steps) {
        const runningSteps = current.steps.map((item) => (
          item.id === step.id ? { ...item, status: STEP_STATUS.RUNNING } : item
        ));
        current = this.store.update(task.id, { steps: runningSteps });
        onUpdate(current);
        if (this.stepDelay > 0) await wait(this.stepDelay);

        const output = await this.registry.execute(step.tool, { goal: task.goal }, context);
        context.outputs[step.tool] = output;
        const completedSteps = current.steps.map((item) => (
          item.id === step.id ? { ...item, status: STEP_STATUS.SUCCESS, output } : item
        ));
        current = this.store.update(task.id, { steps: completedSteps });
        context.task = current;
        onUpdate(current);
      }

      const result = context.outputs["report.compose"];
      current = this.store.update(task.id, {
        status: TASK_STATUS.SUCCESS,
        result,
        completedAt: new Date().toISOString(),
      });
      onUpdate(current);
      return current;
    } catch (error) {
      const failedSteps = current.steps.map((step) => (
        step.status === STEP_STATUS.RUNNING
          ? { ...step, status: STEP_STATUS.FAILED, error: error.message }
          : step
      ));
      current = this.store.update(task.id, {
        status: TASK_STATUS.FAILED,
        steps: failedSteps,
        error: error?.message || "任务执行失败",
        completedAt: new Date().toISOString(),
      });
      onUpdate(current);
      return current;
    }
  }
}
