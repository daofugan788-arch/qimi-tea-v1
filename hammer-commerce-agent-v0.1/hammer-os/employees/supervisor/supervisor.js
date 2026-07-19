import { BaseEmployee } from "../core/base-employee.js";
import { EmployeeContext } from "../core/employee-context.js";
import { EmployeeHeartbeatMonitor } from "../heartbeat/employee-heartbeat-monitor.js";
import { EmployeeToolGateway } from "../tools/employee-tool-gateway.js";

function employeeId(type) {
  return `EMP-${String(type || "employee").toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function incidentId(employeeId) {
  return `EINC-${String(employeeId).replace(/[^a-z0-9]/gi, "-").toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export class Supervisor {
  constructor({
    runtime,
    workspaceFactory,
    messageBus,
    knowledgeCenter,
    eventBus = null,
    memoryService = null,
    heartbeatMonitor = null,
    toolRegistry = null,
    toolApprovalService = null,
    watchdogIntervalMs = 30_000,
    autoStartWatchdog = true,
  } = {}) {
    this.id = "supervisor";
    this.runtime = runtime;
    this.workspaceFactory = workspaceFactory;
    this.messageBus = messageBus;
    this.knowledgeCenter = knowledgeCenter;
    this.eventBus = eventBus;
    this.memoryService = memoryService;
    this.heartbeatMonitor = heartbeatMonitor || new EmployeeHeartbeatMonitor();
    this.toolRegistry = toolRegistry;
    this.toolApprovalService = toolApprovalService;
    this.employeeTypes = new Map();
    this.activeIncidents = new Map();
    this.watchdogIntervalMs = Math.max(10, Number(watchdogIntervalMs) || 30_000);
    this.watchdogTimer = null;
    this.unsubscribe = this.messageBus.register(this.id, (message) => this.onMessage(message));
    if (autoStartWatchdog) this.startWatchdog();
  }

  registerEmployeeType(EmployeeClass, { pluginId = "core" } = {}) {
    if (!(EmployeeClass?.prototype instanceof BaseEmployee)) throw new Error("Employee 必须继承 BaseEmployee");
    const type = EmployeeClass.employeeType || EmployeeClass.name;
    const existing = this.employeeTypes.get(type);
    if (existing && existing.EmployeeClass !== EmployeeClass) throw new Error(`Employee 类型已由 ${existing.pluginId} 注册：${type}`);
    this.employeeTypes.set(type, { EmployeeClass, pluginId });
    return type;
  }

  async hire(EmployeeClass, options = {}) {
    const type = this.registerEmployeeType(EmployeeClass, { pluginId: options.pluginId || this.employeeTypes.get(EmployeeClass.employeeType || EmployeeClass.name)?.pluginId || "direct" });
    const id = options.id || employeeId(type);
    const workspace = options.restore
      ? await this.workspaceFactory.restore(id, type)
      : this.workspaceFactory.create(id, type);
    if (options.restore) workspace.recoverIncompleteMission();
    const toolGateway = new EmployeeToolGateway({
      employeeId: id,
      employeeType: type,
      toolRegistry: this.toolRegistry,
      approvalService: this.toolApprovalService,
      allowedTools: options.allowedTools || EmployeeClass.allowedTools || [],
    });
    const context = new EmployeeContext({
      workspace,
      messageBus: this.messageBus,
      knowledgeCenter: this.knowledgeCenter,
      toolGateway,
    });
    const employee = new EmployeeClass({
      ...(options.recoveryOptions || {}),
      ...options,
      id,
      name: options.name || EmployeeClass.name,
      context,
      supervisorId: this.id,
      heartbeatIntervalMs: options.heartbeatIntervalMs || options.snapshot?.heartbeatIntervalMs,
    });
    await this.runtime.attach(employee, { snapshot: options.snapshot || null });
    await this.persistEmployee(employee.id, {
      active: true,
      hiredAt: options.hiredAt || new Date().toISOString(),
      recoveredAt: options.restore ? new Date().toISOString() : null,
      recoveryOptions: options.recoveryOptions || {},
      allowedTools: [...toolGateway.allowedTools],
    });
    await this.eventBus?.publish("employee.supervisor.hired", { employee: employee.status() }, { source: "employee.supervisor" });
    if (workspace.queue.length && employee.state === "IDLE") void this.runtime.drain(employee.id);
    return employee.status();
  }

  hireByType(type, options = {}) {
    const registration = this.employeeTypes.get(type);
    if (!registration) throw new Error(`Supervisor 未注册员工类型：${type}`);
    return this.hire(registration.EmployeeClass, { ...options, pluginId: registration.pluginId });
  }

  assign(employeeId, mission) {
    return this.runtime.assign(employeeId, mission);
  }

  pause(employeeId, reason = "paused-by-supervisor") {
    const status = this.runtime.pause(employeeId, reason);
    void this.persistEmployee(employeeId);
    return status;
  }

  resume(employeeId) {
    const status = this.runtime.resume(employeeId);
    void this.persistEmployee(employeeId);
    return status;
  }

  async retire(employeeId, reason = "retired-by-supervisor") {
    const employee = this.runtime.get(employeeId);
    const snapshot = employee?.snapshot() || null;
    await this.toolApprovalService?.rejectForEmployee(employeeId, reason);
    await this.resolveIncident(employeeId, "employee-retired");
    const status = await this.runtime.retire(employeeId, reason);
    this.heartbeatMonitor.remove(employeeId);
    if (this.memoryService) {
      const existing = await this.memoryService.read("employee.roster", employeeId) || {};
      await this.memoryService.write("employee.roster", employeeId, {
        ...existing,
        active: false,
        retiredAt: new Date().toISOString(),
        retirementReason: reason,
        snapshot: snapshot ? { ...snapshot, state: status.state, lifecycle: { ...snapshot.lifecycle, state: status.state } } : null,
      });
    }
    return status;
  }

  async persistEmployee(employeeId, extra = {}) {
    if (!this.memoryService) return null;
    const employee = this.runtime.get(employeeId);
    if (!employee) return null;
    const registration = this.employeeTypes.get(employee.type);
    const existing = await this.memoryService.read("employee.roster", employeeId) || {};
    const record = {
      ...existing,
      id: employee.id,
      type: employee.type,
      name: employee.name,
      pluginId: registration?.pluginId || existing.pluginId || "direct",
      active: true,
      snapshot: employee.snapshot(),
      updatedAt: new Date().toISOString(),
      ...extra,
    };
    await this.memoryService.write("employee.roster", employeeId, record);
    return record;
  }

  async recover() {
    if (!this.memoryService) return [];
    await this.toolApprovalService?.expirePersisted("process-restarted");
    const recovered = [];
    for (const entry of await this.memoryService.list("employee.roster")) {
      const record = entry.value;
      if (!record?.active || this.runtime.get(record.id)) continue;
      const registration = this.employeeTypes.get(record.type);
      if (!registration) {
        recovered.push({ id: record.id, type: record.type, status: "MISSING_EMPLOYEE_PLUGIN" });
        continue;
      }
      try {
        const status = await this.hire(registration.EmployeeClass, {
          id: record.id,
          name: record.name,
          pluginId: registration.pluginId,
          restore: true,
          snapshot: record.snapshot,
          hiredAt: record.hiredAt,
          recoveryOptions: record.recoveryOptions || {},
          allowedTools: record.allowedTools,
        });
        recovered.push({ id: record.id, type: record.type, status: "RECOVERED", employee: status });
      } catch (error) {
        recovered.push({ id: record.id, type: record.type, status: "RECOVERY_FAILED", error: error?.message || "Employee recovery failed" });
      }
    }
    return recovered;
  }

  employee(employeeId) {
    const employee = this.runtime.get(employeeId);
    if (!employee) return null;
    return { ...employee.status(), health: this.heartbeatMonitor.status(employeeId) };
  }

  list() {
    return this.runtime.list().map((employee) => ({ ...employee, health: this.heartbeatMonitor.status(employee.id) }));
  }

  pendingToolApprovals() {
    return this.toolApprovalService?.listPending() || [];
  }

  approveTool(requestId, options = {}) {
    if (!this.toolApprovalService) throw new Error("Employee Tool Approval Service 未启动");
    return this.toolApprovalService.approve(requestId, options);
  }

  rejectTool(requestId, options = {}) {
    if (!this.toolApprovalService) throw new Error("Employee Tool Approval Service 未启动");
    return this.toolApprovalService.reject(requestId, options);
  }

  async evaluateEmployee(employeeId) {
    const candidate = this.heartbeatMonitor.incident(employeeId);
    const active = this.activeIncidents.get(employeeId);
    if (!candidate) {
      if (active) await this.resolveIncident(employeeId, "employee-health-recovered");
      return null;
    }
    if (active?.condition === candidate.condition) {
      const updated = {
        ...active,
        ...candidate,
        id: active.id,
        status: active.status,
        openedAt: active.openedAt,
        lastObservedAt: candidate.detectedAt,
        observations: active.observations + 1,
      };
      this.activeIncidents.set(employeeId, updated);
      if (this.memoryService) await this.memoryService.write("employee.incidents", updated.id, updated);
      return { ...updated };
    }
    if (active) await this.resolveIncident(employeeId, `condition-changed-to-${candidate.condition}`);
    const incident = {
      ...candidate,
      id: incidentId(employeeId),
      status: "OPEN",
      openedAt: candidate.detectedAt,
      lastObservedAt: candidate.detectedAt,
      observations: 1,
    };
    this.activeIncidents.set(employeeId, incident);
    if (this.memoryService) await this.memoryService.write("employee.incidents", incident.id, incident);
    await this.persistEmployee(employeeId, {
      healthIncident: {
        id: incident.id,
        condition: incident.condition,
        severity: incident.severity,
        openedAt: incident.openedAt,
      },
    });
    await this.eventBus?.publish("employee.supervisor.incident", { incident }, { source: "employee.supervisor" });
    return { ...incident };
  }

  async resolveIncident(employeeId, resolution = "resolved") {
    const active = this.activeIncidents.get(employeeId);
    if (!active) return null;
    const resolved = {
      ...active,
      status: "RESOLVED",
      resolution: String(resolution || "resolved"),
      resolvedAt: this.heartbeatMonitor.now().toISOString(),
    };
    this.activeIncidents.delete(employeeId);
    if (this.memoryService) await this.memoryService.write("employee.incidents", resolved.id, resolved);
    await this.persistEmployee(employeeId, { healthIncident: null });
    await this.eventBus?.publish("employee.supervisor.incident.resolved", { incident: resolved }, { source: "employee.supervisor" });
    return resolved;
  }

  async inspectWorkforce() {
    const employeeIds = this.runtime.list().map((employee) => employee.id);
    for (const employeeId of employeeIds) await this.evaluateEmployee(employeeId);
    const employees = employeeIds.map((employeeId) => this.employee(employeeId));
    return {
      checkedAt: this.heartbeatMonitor.now().toISOString(),
      totalEmployees: employees.length,
      healthyEmployees: employees.filter((employee) => !this.activeIncidents.has(employee.id)).length,
      employees,
      incidents: [...this.activeIncidents.values()].map((incident) => ({ ...incident })),
    };
  }

  startWatchdog({ intervalMs = this.watchdogIntervalMs, immediate = false } = {}) {
    this.stopWatchdog();
    this.watchdogIntervalMs = Math.max(10, Number(intervalMs) || this.watchdogIntervalMs);
    this.watchdogTimer = setInterval(() => this.runWatchdogInspection(), this.watchdogIntervalMs);
    this.watchdogTimer.unref?.();
    if (immediate) this.runWatchdogInspection();
    return this.watchdogIntervalMs;
  }

  runWatchdogInspection() {
    void this.inspectWorkforce().catch((error) => {
      void this.eventBus?.publish("employee.supervisor.watchdog.failed", {
        error: error?.message || "Supervisor Watchdog inspection failed",
      }, { source: "employee.supervisor" });
    });
  }

  stopWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  close() {
    this.stopWatchdog();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async onMessage(message) {
    if (message.type === "EMPLOYEE_HEARTBEAT") {
      const heartbeat = this.heartbeatMonitor.record(message.payload);
      await this.persistEmployee(message.payload.employeeId);
      await this.evaluateEmployee(message.payload.employeeId);
      await this.eventBus?.publish("employee.supervisor.heartbeat", { heartbeat }, { source: "employee.supervisor" });
      return heartbeat;
    }
    return null;
  }
}
