import { BaseEmployee } from "../core/base-employee.js";
import { EmployeeContext } from "../core/employee-context.js";
import { EmployeeHeartbeatMonitor } from "../heartbeat/employee-heartbeat-monitor.js";

function employeeId(type) {
  return `EMP-${String(type || "employee").toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export class Supervisor {
  constructor({ runtime, workspaceFactory, messageBus, knowledgeCenter, eventBus = null, heartbeatMonitor = null } = {}) {
    this.id = "supervisor";
    this.runtime = runtime;
    this.workspaceFactory = workspaceFactory;
    this.messageBus = messageBus;
    this.knowledgeCenter = knowledgeCenter;
    this.eventBus = eventBus;
    this.heartbeatMonitor = heartbeatMonitor || new EmployeeHeartbeatMonitor();
    this.employeeTypes = new Map();
    this.unsubscribe = this.messageBus.register(this.id, (message) => this.onMessage(message));
  }

  registerEmployeeType(EmployeeClass) {
    if (!(EmployeeClass?.prototype instanceof BaseEmployee)) throw new Error("Employee 必须继承 BaseEmployee");
    const type = EmployeeClass.employeeType || EmployeeClass.name;
    this.employeeTypes.set(type, EmployeeClass);
    return type;
  }

  async hire(EmployeeClass, options = {}) {
    const type = this.registerEmployeeType(EmployeeClass);
    const id = options.id || employeeId(type);
    const workspace = this.workspaceFactory.create(id, type);
    const context = new EmployeeContext({ workspace, messageBus: this.messageBus, knowledgeCenter: this.knowledgeCenter });
    const employee = new EmployeeClass({
      ...options,
      id,
      name: options.name || EmployeeClass.name,
      context,
      supervisorId: this.id,
    });
    await this.runtime.attach(employee);
    await this.eventBus?.publish("employee.supervisor.hired", { employee: employee.status() }, { source: "employee.supervisor" });
    return employee.status();
  }

  hireByType(type, options = {}) {
    const EmployeeClass = this.employeeTypes.get(type);
    if (!EmployeeClass) throw new Error(`Supervisor 未注册员工类型：${type}`);
    return this.hire(EmployeeClass, options);
  }

  assign(employeeId, mission) {
    return this.runtime.assign(employeeId, mission);
  }

  pause(employeeId, reason = "paused-by-supervisor") {
    return this.runtime.pause(employeeId, reason);
  }

  resume(employeeId) {
    return this.runtime.resume(employeeId);
  }

  async retire(employeeId, reason = "retired-by-supervisor") {
    const status = await this.runtime.retire(employeeId, reason);
    this.heartbeatMonitor.remove(employeeId);
    return status;
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
      await this.eventBus?.publish("employee.supervisor.heartbeat", { heartbeat }, { source: "employee.supervisor" });
      return heartbeat;
    }
    return null;
  }
}
