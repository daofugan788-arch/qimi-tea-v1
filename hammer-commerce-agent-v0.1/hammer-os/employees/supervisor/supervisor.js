import { BaseEmployee } from "../core/base-employee.js";
import { EmployeeContext } from "../core/employee-context.js";
import { EmployeeHeartbeatMonitor } from "../heartbeat/employee-heartbeat-monitor.js";

function employeeId(type) {
  return `EMP-${String(type || "employee").toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export class Supervisor {
  constructor({ runtime, workspaceFactory, messageBus, knowledgeCenter, eventBus = null, memoryService = null, heartbeatMonitor = null } = {}) {
    this.id = "supervisor";
    this.runtime = runtime;
    this.workspaceFactory = workspaceFactory;
    this.messageBus = messageBus;
    this.knowledgeCenter = knowledgeCenter;
    this.eventBus = eventBus;
    this.memoryService = memoryService;
    this.heartbeatMonitor = heartbeatMonitor || new EmployeeHeartbeatMonitor();
    this.employeeTypes = new Map();
    this.unsubscribe = this.messageBus.register(this.id, (message) => this.onMessage(message));
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
    const context = new EmployeeContext({ workspace, messageBus: this.messageBus, knowledgeCenter: this.knowledgeCenter });
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

  async onMessage(message) {
    if (message.type === "EMPLOYEE_HEARTBEAT") {
      const heartbeat = this.heartbeatMonitor.record(message.payload);
      await this.persistEmployee(message.payload.employeeId);
      await this.eventBus?.publish("employee.supervisor.heartbeat", { heartbeat }, { source: "employee.supervisor" });
      return heartbeat;
    }
    return null;
  }
}
