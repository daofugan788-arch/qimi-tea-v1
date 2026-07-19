const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export const EMPLOYEE_HEALTH_CONDITION = Object.freeze({
  HEALTHY: "HEALTHY",
  WAITING: "WAITING",
  SLEEPING: "SLEEPING",
  NEED_HELP: "NEED_HELP",
  WAITING_TOO_LONG: "WAITING_TOO_LONG",
  STUCK: "STUCK",
  STALE: "STALE",
  DEAD: "DEAD",
});

const INCIDENT_SEVERITY = Object.freeze({
  NEED_HELP: "MEDIUM",
  WAITING_TOO_LONG: "MEDIUM",
  STUCK: "HIGH",
  STALE: "HIGH",
  DEAD: "CRITICAL",
});

function missionId(payload) {
  return payload?.currentMission?.id || null;
}

export class EmployeeHeartbeatMonitor {
  constructor({
    now = () => new Date(),
    staleAfterMs = 90_000,
    deadAfterMs = 180_000,
    stuckAfterMs = 120_000,
    waitingTooLongAfterMs = 300_000,
  } = {}) {
    this.now = now;
    this.staleAfterMs = Math.max(1, Number(staleAfterMs) || 90_000);
    this.deadAfterMs = Math.max(this.staleAfterMs + 1, Number(deadAfterMs) || 180_000);
    this.stuckAfterMs = Math.max(1, Number(stuckAfterMs) || 120_000);
    this.waitingTooLongAfterMs = Math.max(1, Number(waitingTooLongAfterMs) || 300_000);
    this.records = new Map();
  }

  record(payload) {
    if (!payload?.employeeId) throw new Error("Heartbeat 缺少 employeeId");
    const previous = this.records.get(payload.employeeId);
    const receivedAt = this.now().toISOString();
    const progressChanged = !previous
      || missionId(previous) !== missionId(payload)
      || Number(previous.progress) !== Number(payload.progress)
      || previous.state !== payload.state;
    const record = {
      ...clone(payload),
      receivedAt,
      progressUpdatedAt: progressChanged ? receivedAt : previous.progressUpdatedAt || previous.receivedAt,
      waitingSince: payload.state === "WAITING"
        ? previous?.state === "WAITING" ? previous.waitingSince || previous.receivedAt : receivedAt
        : null,
    };
    this.records.set(payload.employeeId, record);
    return clone(record);
  }

  status(employeeId) {
    const record = this.records.get(employeeId);
    if (!record) return { employeeId, health: "UNKNOWN", lastHeartbeat: null };
    const nowMs = this.now().getTime();
    const ageMs = Math.max(0, nowMs - new Date(record.receivedAt).getTime());
    const progressAgeMs = Math.max(0, nowMs - new Date(record.progressUpdatedAt || record.receivedAt).getTime());
    const waitingAgeMs = record.waitingSince
      ? Math.max(0, nowMs - new Date(record.waitingSince).getTime())
      : 0;
    const health = ageMs > this.deadAfterMs ? "DEAD" : ageMs > this.staleAfterMs ? "STALE" : "ONLINE";
    const condition = health === "DEAD"
      ? EMPLOYEE_HEALTH_CONDITION.DEAD
      : health === "STALE"
        ? EMPLOYEE_HEALTH_CONDITION.STALE
        : record.needHelp
          ? EMPLOYEE_HEALTH_CONDITION.NEED_HELP
          : record.state === "WAITING" && waitingAgeMs > this.waitingTooLongAfterMs
            ? EMPLOYEE_HEALTH_CONDITION.WAITING_TOO_LONG
            : record.state === "WAITING"
              ? EMPLOYEE_HEALTH_CONDITION.WAITING
              : record.state === "WORKING" && missionId(record) && progressAgeMs > this.stuckAfterMs
                ? EMPLOYEE_HEALTH_CONDITION.STUCK
                : record.state === "SLEEPING"
                  ? EMPLOYEE_HEALTH_CONDITION.SLEEPING
                  : EMPLOYEE_HEALTH_CONDITION.HEALTHY;
    return { ...clone(record), health, condition, ageMs, progressAgeMs, waitingAgeMs };
  }

  list() {
    return [...this.records.keys()].map((employeeId) => this.status(employeeId));
  }

  incident(employeeId) {
    const status = this.status(employeeId);
    const severity = INCIDENT_SEVERITY[status.condition];
    if (!severity) return null;
    return {
      employeeId,
      employeeType: status.employeeType || null,
      employeeName: status.name || null,
      condition: status.condition,
      severity,
      state: status.state || null,
      currentMission: clone(status.currentMission || null),
      progress: Number(status.progress) || 0,
      waiting: status.waiting || null,
      needHelp: Boolean(status.needHelp),
      helpReason: status.helpReason || null,
      ageMs: status.ageMs || 0,
      progressAgeMs: status.progressAgeMs || 0,
      waitingAgeMs: status.waitingAgeMs || 0,
      detectedAt: this.now().toISOString(),
    };
  }

  incidents(employeeIds = [...this.records.keys()]) {
    return employeeIds.map((employeeId) => this.incident(employeeId)).filter(Boolean);
  }

  remove(employeeId) {
    return this.records.delete(employeeId);
  }
}
