function messageId() {
  return `EMSG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export class EmployeeMessageBus {
  constructor({ eventBus = null, now = () => new Date() } = {}) {
    this.eventBus = eventBus;
    this.now = now;
    this.receivers = new Map();
    this.mailboxes = new Map();
    this.pendingRequests = new Map();
  }

  register(employeeId, handler) {
    if (!employeeId || typeof handler !== "function") throw new Error("Employee Message receiver 配置无效");
    if (this.receivers.has(employeeId)) throw new Error(`Employee Message receiver 已存在：${employeeId}`);
    this.receivers.set(employeeId, handler);
    return () => this.receivers.delete(employeeId);
  }

  createMessage({ from, to, type, payload = {}, correlationId = null, replyTo = null } = {}) {
    if (!from || !to || !type) throw new Error("Employee Message 必须包含 from、to、type");
    return Object.freeze({
      id: messageId(),
      from: String(from),
      to: String(to),
      type: String(type),
      payload: clone(payload),
      correlationId: correlationId || null,
      replyTo: replyTo || null,
      timestamp: this.now().toISOString(),
    });
  }

  async send(input) {
    const message = this.createMessage(input);
    const mailbox = this.mailboxes.get(message.to) || [];
    mailbox.push(message);
    this.mailboxes.set(message.to, mailbox.slice(-500));
    await this.eventBus?.publish("employee.message.sent", { message }, { source: `employee.${message.from}` });

    const pending = message.correlationId ? this.pendingRequests.get(message.correlationId) : null;
    if (pending && message.to === pending.requester) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(message.correlationId);
      pending.resolve(message);
    }

    const receiver = this.receivers.get(message.to);
    if (!receiver) return { delivered: false, message };
    await receiver(message);
    await this.eventBus?.publish("employee.message.delivered", { messageId: message.id, to: message.to }, { source: "employee.message-bus" });
    return { delivered: true, message };
  }

  request(input, { timeoutMs = 5_000 } = {}) {
    const correlationId = input.correlationId || messageId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`Employee Message 请求超时：${input.to}`));
      }, Math.max(1, timeoutMs));
      timer.unref?.();
      this.pendingRequests.set(correlationId, { requester: String(input.from), resolve, reject, timer });
      void this.send({ ...input, correlationId }).catch((error) => {
        clearTimeout(timer);
        this.pendingRequests.delete(correlationId);
        reject(error);
      });
    });
  }

  inbox(employeeId, limit = 50) {
    return (this.mailboxes.get(employeeId) || []).slice(-Math.max(0, limit)).map((item) => ({ ...item }));
  }
}
