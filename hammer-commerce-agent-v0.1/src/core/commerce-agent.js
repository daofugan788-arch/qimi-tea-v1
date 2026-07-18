export class CommerceAgent {
  constructor({ store, productStore, planner, executor, chainStore, chainPlanner, chainExecutor, salesStore, registry } = {}) {
    this.store = store;
    this.productStore = productStore;
    this.planner = planner;
    this.executor = executor;
    this.chainStore = chainStore;
    this.chainPlanner = chainPlanner;
    this.chainExecutor = chainExecutor;
    this.salesStore = salesStore;
    this.registry = registry;
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

  async runProductComparison(productIds, onUpdate = () => {}) {
    const products = this.productStore.getByIds(productIds);
    if (products.length < 2) throw new Error("至少选择 2 个商品进行对比");
    const task = this.createTask(`对比 ${products.length} 个候选商品，选出优先测试项`, {
      type: "PRODUCT_COMPARISON",
      productIds: products.map((product) => product.id),
      products,
    });
    onUpdate(task);
    return this.executeTask(task, onUpdate);
  }

  async runTaskChain(goal, onUpdate = () => {}) {
    const steps = this.chainPlanner.createPlan(goal);
    const chain = this.chainStore.create(goal, steps);
    onUpdate(chain);
    return this.chainExecutor.run(chain, onUpdate);
  }

  async resumeTaskChain(chainId, signals, onUpdate = () => {}) {
    return this.chainExecutor.resume(chainId, signals, onUpdate);
  }

  async addCandidateAndResume(chainId, text, onUpdate = () => {}) {
    const chain = this.chainStore.get(chainId);
    if (!chain || chain.status !== "BLOCKED" || !["NEED_PRODUCTS", "NO_VIABLE_PRODUCTS"].includes(chain.blocked?.actionType)) {
      throw new Error("当前任务链不需要补充候选商品");
    }
    const product = await this.registry.execute("product.quick.capture", { text });
    const analysis = await this.runProductAnalysis(product);
    if (analysis.status !== "SUCCESS") throw new Error(analysis.error || "候选商品分析失败");
    return this.resumeTaskChain(chainId, { productsUpdated: true }, onUpdate);
  }

  getHistory() {
    return this.store.list();
  }

  getProducts() {
    return this.productStore.list();
  }

  getChains() {
    return this.chainStore.list();
  }

  getSales() {
    return this.salesStore.list();
  }
}
