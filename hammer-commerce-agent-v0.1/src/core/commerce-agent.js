export class CommerceAgent {
  constructor({ store, productStore, planner, executor } = {}) {
    this.store = store;
    this.productStore = productStore;
    this.planner = planner;
    this.executor = executor;
  }

  createTask(goal, metadata) {
    return this.store.create(goal, metadata);
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

  async runProductAnalysis(product, onUpdate = () => {}) {
    const name = String(product?.name || "").trim();
    if (!name) throw new Error("请输入商品名称");
    const task = this.createTask(`分析商品「${name}」能不能卖`, {
      type: "PRODUCT_ANALYSIS",
      product: { ...product, name },
    });
    onUpdate(task);
    let completed = await this.executeTask(task, onUpdate);
    if (completed.status === "SUCCESS" && completed.result) {
      const savedProduct = this.productStore.saveAnalysis(completed.product, completed.result);
      completed = this.store.update(completed.id, {
        result: { ...completed.result, productId: savedProduct.id },
      });
      onUpdate(completed);
    }
    return completed;
  }

  getHistory() {
    return this.store.list();
  }

  getProducts() {
    return this.productStore.list();
  }
}
