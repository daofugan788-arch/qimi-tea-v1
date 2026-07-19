import { EmployeeMessageBus } from "./communication/employee-message-bus.js";
import { KnowledgeCenter } from "./knowledge/knowledge-center.js";
import { EmployeeRuntime } from "./runtime/employee-runtime.js";
import { Supervisor } from "./supervisor/supervisor.js";
import { EmployeeWorkspaceFactory } from "./workspace/employee-workspace.js";

export function createEmployeeFramework({ eventBus = null, memoryService = null, now = () => new Date() } = {}) {
  const messageBus = new EmployeeMessageBus({ eventBus, now });
  const knowledgeCenter = new KnowledgeCenter({ memoryService, eventBus, now });
  const workspaceFactory = new EmployeeWorkspaceFactory({ memoryService, now });
  const employeeRuntime = new EmployeeRuntime({ eventBus });
  const supervisor = new Supervisor({ runtime: employeeRuntime, workspaceFactory, messageBus, knowledgeCenter, eventBus, memoryService });
  return { employeeRuntime, supervisor, employeeMessageBus: messageBus, knowledgeCenter, employeeWorkspaceFactory: workspaceFactory };
}

export { BaseEmployee } from "./core/base-employee.js";
export { EmployeeContext } from "./core/employee-context.js";
export { EmployeeLifecycle } from "./core/employee-lifecycle.js";
export { EMPLOYEE_STATE, EMPLOYEE_TRANSITIONS, canTransitionEmployee } from "./core/employee-state.js";
export { EmployeeMessageBus } from "./communication/employee-message-bus.js";
export { EmployeeHeartbeatMonitor } from "./heartbeat/employee-heartbeat-monitor.js";
export { KnowledgeCenter } from "./knowledge/knowledge-center.js";
export { EmployeeRuntime } from "./runtime/employee-runtime.js";
export { Supervisor } from "./supervisor/supervisor.js";
export { EmployeeWorkspace, EmployeeWorkspaceFactory } from "./workspace/employee-workspace.js";
