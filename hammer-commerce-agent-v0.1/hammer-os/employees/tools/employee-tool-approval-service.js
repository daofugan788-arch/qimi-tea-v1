const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function approvalId() {
  return `ETAP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function redact(value, key = "") {
  if (/password|passwd|secret|token|api[-_]?key|authorization|cookie/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  return clone(value);
}

export class EmployeeToolApprovalError extends Error {
  constructor(message, { code = "EMPLOYEE_TOOL_APPROVAL_REJECTED", requestId = null } = {}) {
    super(message);
    this.name = "EmployeeToolApprovalError";
    this.code = code;
    this.requestId = requestId;
  }
}

export class EmployeeToolApprovalService {
  constructor({ eventBus = null, memoryService = null, now = () => new Date(), timeoutMs = 300_000 } = {}) {
    this.eventBus = eventBus;
    this.memoryService = memoryService;
    this.now = now;
    this.timeoutMs = Math.max(1, Number(timeoutMs) || 300_000);
    this.pending = new Map();
  }

  async request({ employeeId, employeeType, missionId = null, tool, input = {}, riskLevel = "HIGH" } = {}) {
    if (!employeeId || !tool) throw new Error("Tool Approval 需要 employeeId 和 tool");
    const record = {
      id: approvalId(),
      employeeId,
      employeeType: employeeType || null,
      missionId,
      tool,
      riskLevel,
      input: redact(input),
      status: "PENDING",
      requestedAt: this.now().toISOString(),
      decidedAt: null,
      decidedBy: null,
      reason: null,
    };
    let resolveApproval;
    let rejectApproval;
    const approval = new Promise((resolve, reject) => {
      resolveApproval = resolve;
      rejectApproval = reject;
    });
    const pending = { record, resolve: resolveApproval, reject: rejectApproval, timer: null };
    this.pending.set(record.id, pending);
    try {
      if (this.memoryService) await this.memoryService.write("employee.tool-approvals", record.id, record);
      pending.timer = setTimeout(() => void this.expire(record.id, "approval-timeout"), this.timeoutMs);
      pending.timer.unref?.();
      await this.eventBus?.publish("employee.tool.approval.requested", { request: record }, {
        source: `employee.${employeeId}`,
        missionId,
      });
    } catch (error) {
      clearTimeout(pending.timer);
      this.pending.delete(record.id);
      rejectApproval(error);
    }
    return approval;
  }

  listPending() {
    return [...this.pending.values()].map(({ record }) => clone(record));
  }

  async approve(requestId, { decidedBy = "supervisor", reason = "approved" } = {}) {
    return this.decide(requestId, { status: "APPROVED", decidedBy, reason });
  }

  async reject(requestId, { decidedBy = "supervisor", reason = "rejected" } = {}) {
    return this.decide(requestId, { status: "REJECTED", decidedBy, reason });
  }

  async expire(requestId, reason = "expired") {
    return this.decide(requestId, { status: "EXPIRED", decidedBy: "system", reason });
  }

  async decide(requestId, { status, decidedBy, reason } = {}) {
    const pending = this.pending.get(requestId);
    if (!pending) throw new Error(`Tool Approval 不存在或已处理：${requestId}`);
    clearTimeout(pending.timer);
    const record = {
      ...pending.record,
      status,
      decidedAt: this.now().toISOString(),
      decidedBy: String(decidedBy || "supervisor"),
      reason: String(reason || status.toLowerCase()),
    };
    try {
      if (this.memoryService) await this.memoryService.write("employee.tool-approvals", record.id, record);
      await this.eventBus?.publish(`employee.tool.approval.${status.toLowerCase()}`, { request: record }, {
        source: "employee.supervisor",
        missionId: record.missionId,
      });
    } catch (error) {
      pending.timer = setTimeout(() => void this.expire(record.id, "approval-timeout"), this.timeoutMs);
      pending.timer.unref?.();
      throw error;
    }
    this.pending.delete(requestId);
    if (status === "APPROVED") pending.resolve(clone(record));
    else pending.reject(new EmployeeToolApprovalError(`Tool ${record.tool} ${record.reason}`, {
      code: status === "EXPIRED" ? "EMPLOYEE_TOOL_APPROVAL_EXPIRED" : "EMPLOYEE_TOOL_APPROVAL_REJECTED",
      requestId: record.id,
    }));
    return clone(record);
  }

  async expirePersisted(reason = "process-restarted") {
    if (!this.memoryService) return [];
    const expired = [];
    for (const entry of await this.memoryService.list("employee.tool-approvals")) {
      const record = entry.value;
      if (record?.status !== "PENDING" || this.pending.has(record.id)) continue;
      const updated = {
        ...record,
        status: "EXPIRED",
        decidedAt: this.now().toISOString(),
        decidedBy: "system",
        reason,
      };
      await this.memoryService.write("employee.tool-approvals", updated.id, updated);
      await this.eventBus?.publish("employee.tool.approval.expired", { request: updated }, {
        source: "employee.supervisor",
        missionId: updated.missionId,
      });
      expired.push(updated);
    }
    return expired.map(clone);
  }

  async rejectForEmployee(employeeId, reason = "employee-retired") {
    const requestIds = [...this.pending.values()]
      .filter(({ record }) => record.employeeId === employeeId)
      .map(({ record }) => record.id);
    const rejected = [];
    for (const requestId of requestIds) {
      rejected.push(await this.reject(requestId, { decidedBy: "supervisor", reason }));
    }
    return rejected;
  }
}
