import { AgentRegistry } from "./agents/agent-registry.js";
import { DecisionService } from "./core/decision/decision-service.js";
import { EventBus } from "./core/eventbus/event-bus.js";
import { EventLogger } from "./core/eventbus/event-logger.js";
import { MemoryService } from "./core/memory/memory-service.js";
import { Orchestrator } from "./core/orchestrator/orchestrator.js";
import { PlannerRegistry } from "./core/planner/planner-registry.js";
import { HammerRuntime } from "./core/runtime/hammer-runtime.js";
import { RuntimeScheduler } from "./core/scheduler/runtime-scheduler.js";
import { PluginManager } from "./plugins/plugin-manager.js";
import { ToolRegistry } from "./tools/tool-registry.js";
import { createEmployeeFramework } from "./employees/index.js";

export function createHammerOS({ plugins = [], memoryAdapter = undefined, now = undefined, employeeNow = undefined } = {}) {
  const eventBus = new EventBus();
  const memoryService = new MemoryService({ adapter: memoryAdapter, eventBus });
  const decisionService = new DecisionService({ eventBus });
  const eventLogger = new EventLogger(eventBus);
  const plannerRegistry = new PlannerRegistry();
  const agentRegistry = new AgentRegistry();
  const toolRegistry = new ToolRegistry({ eventBus });
  const scheduler = new RuntimeScheduler({ ...(now ? { now } : {}) });
  const runtime = new HammerRuntime({
    eventBus,
    agentRegistry,
    toolRegistry,
    memoryService,
    decisionService,
    scheduler,
  });
  const orchestrator = new Orchestrator({ runtime, planner: plannerRegistry, eventBus });
  const pluginManager = new PluginManager({
    agentRegistry,
    toolRegistry,
    decisionService,
    plannerRegistry,
    eventBus,
    memoryService,
    orchestrator,
    runtime,
    scheduler,
  });
  plugins.forEach((plugin) => pluginManager.install(plugin));
  const employeeFramework = createEmployeeFramework({ eventBus, memoryService, ...(employeeNow ? { now: employeeNow } : {}) });
  return {
    orchestrator,
    runtime,
    eventBus,
    eventLogger,
    memoryService,
    decisionService,
    scheduler,
    toolRegistry,
    agentRegistry,
    plannerRegistry,
    pluginManager,
    ...employeeFramework,
  };
}

export { BaseAgent } from "./agents/base-agent.js";
export { JsonFileMemoryAdapter } from "./core/memory/json-file-memory-adapter.js";
export { definePlugin } from "./plugins/plugin-contract.js";
export { TOOL_RISK, TOOL_TYPE } from "./tools/tool-types.js";
export * from "./employees/index.js";
