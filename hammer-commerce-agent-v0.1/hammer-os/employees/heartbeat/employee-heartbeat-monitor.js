const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export class EmployeeHeartbeatMonitor {
  constructor({ now = () => new Date(), staleAfterMs = 90_000, deadAfterMs = 180_000 } = {}) {
    this.now = now;
    this.staleAfterMs = staleAfterMs;
    this.deadAfterMs = deadAfterMs;
    this.records = new Map();
  }

  record(payload) {
    if (!payload?.employeeId) throw new Error("Heartbeat 缺少 employeeId");
    const record = { ...clone(payload), receivedAt: this.now().toISOString() };
    this.records.set(payload.employeeId, record);
    return clone(record);
  }

  status(employeeId) {
    const record = this.records.get(employeeId);
    if (!record) return { employeeId, health: "UNKNOWN", lastHeartbeat: null };
    const ageMs = Math.max(0, this.now().getTime() - new Date(record.receivedAt).getTime());
    const health = ageMs > this.deadAfterMs ? "DEAD" : ageMs > this.staleAfterMs ? "STALE" : "ONLINE";
    const condition = health === "DEAD"
      ? "DEAD"
      : health === "STALE" ? "STALE" : record.needHelp ? "NEED_HELP" : record.state === "WAITING" ? "WAITING" : "HEALTHY";
    return { ...clone(record), health, condition, ageMs };
  }

  list() {
    return [...this.records.keys()].map((employeeId) => this.status(employeeId));
  }

  remove(employeeId) {
    return this.records.delete(employeeId);
  }
}
