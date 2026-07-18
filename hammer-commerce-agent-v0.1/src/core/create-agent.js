import { AgentExecutor } from "./agent-executor.js";
import { AgentPlanner } from "./agent-planner.js";
import { CommerceAgent } from "./commerce-agent.js";
import { TaskStore } from "./task-store.js";
import { ProductStore } from "./product-store.js";
import { createToolRegistry } from "../tools/create-tool-registry.js";
import { ChainStore } from "./chain-store.js";
import { ChainPlanner } from "./chain-planner.js";
import { ChainExecutor } from "./chain-executor.js";
import { SalesStore } from "./sales-store.js";

export function createCommerceAgent({ storage, stepDelay } = {}) {
  const store = new TaskStore(storage);
  const productStore = new ProductStore(storage);
  const chainStore = new ChainStore(storage);
  const salesStore = new SalesStore(storage);
  const planner = new AgentPlanner();
  const registry = createToolRegistry({ productStore, salesStore });
  const executor = new AgentExecutor({ store, registry, stepDelay });
  const chainPlanner = new ChainPlanner();
  const chainExecutor = new ChainExecutor({ store: chainStore, registry, stepDelay });
  return new CommerceAgent({
    store,
    productStore,
    planner,
    executor,
    chainStore,
    chainPlanner,
    chainExecutor,
    salesStore,
    registry,
  });
}
