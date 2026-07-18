import { AgentExecutor } from "./agent-executor.js";
import { AgentPlanner } from "./agent-planner.js";
import { CommerceAgent } from "./commerce-agent.js";
import { TaskStore } from "./task-store.js";
import { ProductStore } from "./product-store.js";
import { createToolRegistry } from "../tools/create-tool-registry.js";

export function createCommerceAgent({ storage, stepDelay } = {}) {
  const store = new TaskStore(storage);
  const productStore = new ProductStore(storage);
  const planner = new AgentPlanner();
  const registry = createToolRegistry();
  const executor = new AgentExecutor({ store, registry, stepDelay });
  return new CommerceAgent({ store, productStore, planner, executor });
}
