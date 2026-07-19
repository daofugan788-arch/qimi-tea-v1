import { EmployeeMessageBus } from "./communication/employee-message-bus.js";
import { EmployeeHeartbeatMonitor } from "./heartbeat/employee-heartbeat-monitor.js";
import { KnowledgeCenter } from "./knowledge/knowledge-center.js";
import { EmployeeRuntime } from "./runtime/employee-runtime.js";
import { Supervisor } from "./supervisor/supervisor.js";
import { EmployeeToolApprovalService } from "./tools/employee-tool-approval-service.js";
import { EmployeeWorkspaceFactory } from "./workspace/employee-workspace.js";

export function createEmployeeFramework({
  eventBus = null,
  memoryService = null,
  toolRegistry = null,
  now = () => new Date(),
  health = {},
  toolApproval = {},
} = {}) {
  const messageBus = new EmployeeMessageBus({ eventBus, now });
  const knowledgeCenter = new KnowledgeCenter({ memoryService, eventBus, now });
  const workspaceFactory = new EmployeeWorkspaceFactory({ memoryService, now });
  const employeeRuntime = new EmployeeRuntime({ eventBus });
  const heartbeatMonitor = new EmployeeHeartbeatMonitor({ ...health, now });
  const employeeToolApprovalService = new EmployeeToolApprovalService({
    eventBus,
    memoryService,
    now,
    timeoutMs: toolApproval.timeoutMs,
  });
  const supervisor = new Supervisor({
    runtime: employeeRuntime,
    workspaceFactory,
    messageBus,
    knowledgeCenter,
    eventBus,
    memoryService,
    heartbeatMonitor,
    toolRegistry,
    toolApprovalService: employeeToolApprovalService,
    watchdogIntervalMs: health.watchdogIntervalMs,
    autoStartWatchdog: health.autoStartWatchdog !== false,
  });
  return {
    employeeRuntime,
    supervisor,
    employeeMessageBus: messageBus,
    knowledgeCenter,
    employeeWorkspaceFactory: workspaceFactory,
    employeeToolApprovalService,
  };
}

export { BaseEmployee } from "./core/base-employee.js";
export { EmployeeContext } from "./core/employee-context.js";
export { EmployeeLifecycle } from "./core/employee-lifecycle.js";
export { EMPLOYEE_STATE, EMPLOYEE_TRANSITIONS, canTransitionEmployee } from "./core/employee-state.js";
export { EmployeeMessageBus } from "./communication/employee-message-bus.js";
export { EMPLOYEE_HEALTH_CONDITION, EmployeeHeartbeatMonitor } from "./heartbeat/employee-heartbeat-monitor.js";
export { KnowledgeCenter } from "./knowledge/knowledge-center.js";
export { EmployeeRuntime } from "./runtime/employee-runtime.js";
export { Supervisor } from "./supervisor/supervisor.js";
export { EmployeeToolGateway } from "./tools/employee-tool-gateway.js";
export { EmployeeToolApprovalError, EmployeeToolApprovalService } from "./tools/employee-tool-approval-service.js";
export { EmployeeWorkspace, EmployeeWorkspaceFactory } from "./workspace/employee-workspace.js";
