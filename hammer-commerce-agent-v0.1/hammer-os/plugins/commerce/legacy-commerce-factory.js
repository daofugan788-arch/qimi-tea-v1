import { AgentExecutor } from "../../../src/core/agent-executor.js";
import { AgentPlanner } from "../../../src/core/agent-planner.js";
import { CommerceAgent as LegacyCommerceFacade } from "../../../src/core/commerce-agent.js";
import { TaskStore } from "../../../src/core/task-store.js";
import { ProductStore } from "../../../src/core/product-store.js";
import { createToolRegistry } from "../../../src/tools/create-tool-registry.js";
import { ChainStore } from "../../../src/core/chain-store.js";
import { ChainPlanner } from "../../../src/core/chain-planner.js";
import { ChainExecutor } from "../../../src/core/chain-executor.js";
import { SalesStore } from "../../../src/core/sales-store.js";
import { BrowserAgentClient } from "../../../src/core/browser-agent-client.js";
import { EvidenceStore } from "../../../src/core/evidence-store.js";

export function createLegacyCommerceAgent({ storage, stepDelay, browserGatewayUrl = "", browserFetch } = {}) {
  const store = new TaskStore(storage);
  const productStore = new ProductStore(storage);
  const chainStore = new ChainStore(storage);
  const salesStore = new SalesStore(storage);
  const evidenceStore = new EvidenceStore(storage);
  const browserClient = new BrowserAgentClient({ baseUrl: browserGatewayUrl, fetchImpl: browserFetch || globalThis.fetch });
  const planner = new AgentPlanner();
  const registry = createToolRegistry({ productStore, salesStore, evidenceStore, browserClient });
  const executor = new AgentExecutor({ store, registry, stepDelay });
  const chainPlanner = new ChainPlanner();
  const chainExecutor = new ChainExecutor({ store: chainStore, registry, stepDelay });
  return new LegacyCommerceFacade({
    store,
    productStore,
    planner,
    executor,
    chainStore,
    chainPlanner,
    chainExecutor,
    salesStore,
    evidenceStore,
    registry,
  });
}
