export class CommerceAgent {
  constructor({ store, planner, executor } = {}) {
    this.store = store;
    this.planner = planner;
    this.executor = executor;
  }

  createTask(goal) {
    return this.store.create(goal);
  }

  async executeTask(task, onUpdate) {
    const plan = this.planner.createPlan(task);
    return this.executor.run(task, plan, onUpdate);
  }

  async run(goal, onUpdate = () => {}) {
    const task = this.createTask(goal);
    onUpdate(task);
    return this.executeTask(task, onUpdate);
  }

  getHistory() {
    return this.store.list();
  }
}
