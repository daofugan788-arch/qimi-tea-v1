import { EMPLOYEE_STATE } from "../core/employee-state.js";

function missionId() {
  return `EMSN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export class EmployeeRuntime {
  constructor({ eventBus = null } = {}) {
    this.eventBus = eventBus;
    this.employees = new Map();
    this.active = new Map();
    this.pending = new Map();
  }

  async attach(employee, { snapshot = null } = {}) {
    if (!employee?.id) throw new Error("EmployeeRuntime 只能挂载 BaseEmployee");
    if (this.employees.has(employee.id)) throw new Error(`Employee 已存在：${employee.id}`);
    this.employees.set(employee.id, employee);
    try {
      if (snapshot) employee.restore(snapshot);
      await employee.initialize({ restored: Boolean(snapshot) });
    } catch (error) {
      this.employees.delete(employee.id);
      employee.stopHeartbeat?.();
      employee.unsubscribeMessages?.();
      employee.unsubscribeMessages = null;
      throw error;
    }
    await this.eventBus?.publish("employee.runtime.attached", { employee: employee.status() }, { source: "employee.runtime" });
    return employee.status();
  }

  get(employeeId) {
    return this.employees.get(employeeId) || null;
  }

  async assign(employeeId, input = {}) {
    const employee = this.require(employeeId);
    if (employee.state === EMPLOYEE_STATE.FINISHED) throw new Error(`Employee ${employeeId} 已结束`);
    const mission = {
      id: input.id || missionId(),
      goal: String(input.goal || input.title || "Employee Mission"),
      input: input.input || {},
      priority: Number(input.priority) || 0,
      assignedAt: new Date().toISOString(),
    };
    employee.context.workspace.enqueue(mission);
    const completion = new Promise((resolve, reject) => this.pending.set(mission.id, { resolve, reject }));
    void this.drain(employeeId);
    return completion;
  }

  async drain(employeeId) {
    const employee = this.get(employeeId);
    if (!employee) return;
    if (this.active.has(employeeId) || [EMPLOYEE_STATE.SLEEPING, EMPLOYEE_STATE.FINISHED].includes(employee.state)) return;
    const mission = employee.context.workspace.dequeue();
    if (!mission) return;
    this.active.set(employeeId, mission);
    employee.context.workspace.setMission(mission);
    employee.progress = 0;
    if (employee.state === EMPLOYEE_STATE.RESUME) employee.lifecycle.transition(EMPLOYEE_STATE.WORKING, { reason: "mission-resumed" });
    else if (employee.state === EMPLOYEE_STATE.IDLE) employee.lifecycle.transition(EMPLOYEE_STATE.WORKING, { reason: "mission-assigned" });
    await this.eventBus?.publish("employee.mission.started", { employeeId, mission }, { source: "employee.runtime" });
    let completed = null;
    let failed = null;
    try {
      const result = await employee.execute(mission);
      employee.reportProgress(100, "mission-completed");
      employee.context.workspace.clearMission(result);
      if (employee.state === EMPLOYEE_STATE.WAITING) employee.lifecycle.transition(EMPLOYEE_STATE.WORKING, { reason: "mission-wait-ended" });
      if (employee.state === EMPLOYEE_STATE.WORKING) employee.lifecycle.transition(EMPLOYEE_STATE.IDLE, { reason: "mission-completed" });
      completed = { mission, result, employee: employee.status() };
      await this.eventBus?.publish("employee.mission.completed", { employeeId, missionId: mission.id, result }, { source: "employee.runtime" });
    } catch (error) {
      employee.context.workspace.record("MISSION_FAILED", { missionId: mission.id, error: error?.message || "Employee mission failed" });
      employee.context.workspace.clearMission({ error: error?.message || "Employee mission failed" });
      if (employee.state === EMPLOYEE_STATE.WAITING) employee.lifecycle.transition(EMPLOYEE_STATE.WORKING, { reason: "mission-failed-after-wait" });
      if (employee.state === EMPLOYEE_STATE.WORKING) employee.lifecycle.transition(EMPLOYEE_STATE.IDLE, { reason: "mission-failed" });
      failed = error;
      await this.eventBus?.publish("employee.mission.failed", { employeeId, missionId: mission.id, error: error?.message || "Employee mission failed" }, { source: "employee.runtime" });
    } finally {
      this.active.delete(employeeId);
      await employee.context.workspace.flush();
      const pending = this.pending.get(mission.id);
      this.pending.delete(mission.id);
      if (failed) pending?.reject(failed);
      else pending?.resolve(completed);
      void this.drain(employeeId);
    }
  }

  pause(employeeId, reason) {
    return this.require(employeeId).sleep(reason);
  }

  resume(employeeId) {
    const employee = this.require(employeeId);
    const status = employee.resume({ working: this.active.has(employeeId) });
    void this.drain(employeeId);
    return status;
  }

  async retire(employeeId, reason) {
    const employee = this.require(employeeId);
    const status = employee.finish(reason);
    this.employees.delete(employeeId);
    this.active.delete(employeeId);
    await employee.context.workspace.flush();
    await this.eventBus?.publish("employee.runtime.retired", { employeeId, reason }, { source: "employee.runtime" });
    return status;
  }

  require(employeeId) {
    const employee = this.get(employeeId);
    if (!employee) throw new Error(`EmployeeRuntime 找不到员工：${employeeId}`);
    return employee;
  }

  list() {
    return [...this.employees.values()].map((employee) => employee.status());
  }
}
