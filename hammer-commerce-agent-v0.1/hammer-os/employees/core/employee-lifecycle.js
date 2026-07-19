import { canTransitionEmployee, EMPLOYEE_STATE } from "./employee-state.js";

export class EmployeeLifecycle {
  constructor({ employeeId, now = () => new Date(), onTransition = null } = {}) {
    if (!employeeId) throw new Error("EmployeeLifecycle 缺少 employeeId");
    this.employeeId = employeeId;
    this.now = now;
    this.onTransition = onTransition;
    this.state = EMPLOYEE_STATE.CREATED;
    this.history = [{ from: null, to: this.state, reason: "employee-created", timestamp: this.now().toISOString() }];
  }

  transition(to, { reason = "", metadata = {} } = {}) {
    if (to === this.state) return this.snapshot();
    if (!canTransitionEmployee(this.state, to)) {
      throw new Error(`Employee 生命周期不允许 ${this.state} → ${to}`);
    }
    const record = {
      from: this.state,
      to,
      reason: String(reason || ""),
      metadata,
      timestamp: this.now().toISOString(),
    };
    this.state = to;
    this.history.push(record);
    this.onTransition?.(record);
    return this.snapshot();
  }

  snapshot() {
    return { state: this.state, history: this.history.map((item) => ({ ...item })) };
  }
}
