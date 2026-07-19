import { EmployeeLifecycle } from "./employee-lifecycle.js";
import { EMPLOYEE_STATE } from "./employee-state.js";

export class BaseEmployee {
  static employeeType = "employee";

  constructor({
    id,
    name = "Employee",
    context,
    heartbeatIntervalMs = 30_000,
    supervisorId = "supervisor",
    now = () => new Date(),
  } = {}) {
    if (!id || !context) throw new Error("BaseEmployee 需要 id 和 EmployeeContext");
    this.id = id;
    this.name = name;
    this.type = this.constructor.employeeType || this.constructor.name;
    this.context = context;
    this.heartbeatIntervalMs = Math.max(10, Number(heartbeatIntervalMs) || 30_000);
    this.supervisorId = supervisorId;
    this.now = now;
    this.progress = 0;
    this.waitingFor = null;
    this.needHelp = false;
    this.helpReason = "";
    this.heartbeatTimer = null;
    this.unsubscribeMessages = null;
    this.resumeGate = null;
    this.releaseResumeGate = null;
    this.lifecycle = new EmployeeLifecycle({
      employeeId: id,
      now,
      onTransition: (record) => this.context.workspace.record("LIFECYCLE_TRANSITION", record),
    });
  }

  get state() {
    return this.lifecycle.state;
  }

  async initialize() {
    if (this.state !== EMPLOYEE_STATE.CREATED) return this.status();
    this.unsubscribeMessages = this.context.communication.register(this.id, (message) => this.receiveMessage(message));
    this.lifecycle.transition(EMPLOYEE_STATE.IDLE, { reason: "employee-initialized" });
    this.startHeartbeat();
    await this.heartbeat();
    return this.status();
  }

  async execute() {
    throw new Error(`${this.constructor.name} 必须实现 execute(mission)`);
  }

  async receiveMessage(message) {
    this.context.workspace.record("MESSAGE_RECEIVED", { id: message.id, from: message.from, type: message.type });
    return this.onMessage(message);
  }

  async onMessage() {
    return null;
  }

  send(to, type, payload = {}, metadata = {}) {
    return this.context.communication.send({ from: this.id, to, type, payload, ...metadata });
  }

  reply(message, type, payload = {}) {
    return this.send(message.from, type, payload, { correlationId: message.correlationId, replyTo: message.id });
  }

  request(to, type, payload = {}, options = {}) {
    return this.waitFor(
      this.context.communication.request({ from: this.id, to, type, payload }, options),
      `等待 ${to} 回复 ${type}`,
    );
  }

  async waitFor(promise, reason = "等待外部结果") {
    const wasWorking = this.state === EMPLOYEE_STATE.WORKING;
    if (wasWorking) {
      this.waitingFor = String(reason);
      this.lifecycle.transition(EMPLOYEE_STATE.WAITING, { reason: this.waitingFor });
      await this.heartbeat();
    }
    try {
      return await promise;
    } finally {
      if (this.state === EMPLOYEE_STATE.WAITING) {
        this.waitingFor = null;
        this.lifecycle.transition(EMPLOYEE_STATE.WORKING, { reason: "wait-completed" });
      }
    }
  }

  reportProgress(progress, detail = "") {
    this.progress = Math.max(0, Math.min(100, Number(progress) || 0));
    this.context.workspace.record("PROGRESS_UPDATED", { progress: this.progress, detail: String(detail || "") });
    return this.progress;
  }

  askForHelp(reason) {
    this.needHelp = true;
    this.helpReason = String(reason || "需要 Supervisor 帮助");
    void this.heartbeat();
  }

  clearHelp() {
    this.needHelp = false;
    this.helpReason = "";
  }

  sleep(reason = "paused-by-supervisor") {
    if (this.state === EMPLOYEE_STATE.SLEEPING) return this.status();
    this.resumeGate = new Promise((resolve) => { this.releaseResumeGate = resolve; });
    this.lifecycle.transition(EMPLOYEE_STATE.SLEEPING, { reason });
    return this.status();
  }

  resume({ working = false } = {}) {
    if (this.state !== EMPLOYEE_STATE.SLEEPING) throw new Error(`Employee ${this.id} 当前不是 SLEEPING`);
    this.lifecycle.transition(EMPLOYEE_STATE.RESUME, { reason: "resume-by-supervisor" });
    this.lifecycle.transition(working ? EMPLOYEE_STATE.WORKING : EMPLOYEE_STATE.IDLE, { reason: "resume-completed" });
    this.releaseResumeGate?.();
    this.resumeGate = null;
    this.releaseResumeGate = null;
    return this.status();
  }

  async checkpoint(reason = "employee-checkpoint") {
    this.context.workspace.record("EMPLOYEE_CHECKPOINT", { reason, state: this.state, progress: this.progress });
    if (this.state === EMPLOYEE_STATE.SLEEPING && this.resumeGate) await this.resumeGate;
    return this.status();
  }

  finish(reason = "retired-by-supervisor") {
    if (this.state === EMPLOYEE_STATE.FINISHED) return this.status();
    this.lifecycle.transition(EMPLOYEE_STATE.FINISHED, { reason });
    this.stopHeartbeat();
    this.unsubscribeMessages?.();
    this.unsubscribeMessages = null;
    return this.status();
  }

  startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  heartbeatPayload() {
    return {
      message: "I'm Alive",
      employeeId: this.id,
      employeeType: this.type,
      name: this.name,
      state: this.state,
      currentMission: this.context.workspace.mission,
      progress: this.progress,
      waiting: this.waitingFor,
      needHelp: this.needHelp,
      helpReason: this.helpReason || null,
      timestamp: this.now().toISOString(),
    };
  }

  async heartbeat() {
    if (this.state === EMPLOYEE_STATE.FINISHED) return null;
    return this.send(this.supervisorId, "EMPLOYEE_HEARTBEAT", this.heartbeatPayload());
  }

  status() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      state: this.state,
      currentMission: this.context.workspace.mission,
      progress: this.progress,
      waiting: this.waitingFor,
      needHelp: this.needHelp,
      helpReason: this.helpReason || null,
    };
  }
}
