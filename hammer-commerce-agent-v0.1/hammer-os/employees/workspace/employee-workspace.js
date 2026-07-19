const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export class EmployeeWorkspace {
  constructor({ employeeId, employeeType, memoryService = null, now = () => new Date() } = {}) {
    if (!employeeId) throw new Error("EmployeeWorkspace 缺少 employeeId");
    this.employeeId = employeeId;
    this.employeeType = employeeType || "employee";
    this.memoryService = memoryService;
    this.now = now;
    this.mission = null;
    this.memory = new Map();
    this.knowledge = new Map();
    this.history = [];
    this.queue = [];
    this.decision = [];
    this.writeChain = Promise.resolve();
  }

  persist() {
    if (!this.memoryService) return this.writeChain;
    const snapshot = this.snapshot();
    this.writeChain = this.writeChain.then(() => this.memoryService.write("employee.workspaces", this.employeeId, snapshot));
    return this.writeChain;
  }

  setMission(mission) {
    this.mission = clone(mission);
    this.record("MISSION_STARTED", { mission: this.mission });
    return this.mission;
  }

  clearMission(result = null) {
    const mission = this.mission;
    this.record("MISSION_FINISHED", { missionId: mission?.id || null, result: clone(result) });
    this.mission = null;
    this.persist();
  }

  enqueue(mission) {
    this.queue.push(clone(mission));
    this.record("MISSION_QUEUED", { missionId: mission?.id || null });
    return this.queue.length;
  }

  dequeue() {
    const mission = this.queue.shift() || null;
    if (mission) this.record("MISSION_DEQUEUED", { missionId: mission.id || null });
    return mission;
  }

  remember(key, value) {
    this.memory.set(String(key), clone(value));
    this.record("MEMORY_UPDATED", { key: String(key) });
    return clone(value);
  }

  recall(key) {
    return clone(this.memory.get(String(key)));
  }

  saveKnowledgeReference(key, value) {
    this.knowledge.set(String(key), clone(value));
    this.record("KNOWLEDGE_REFERENCED", { key: String(key) });
    return clone(value);
  }

  addDecision(decision) {
    const record = { ...clone(decision), timestamp: decision?.timestamp || this.now().toISOString() };
    this.decision.push(record);
    this.record("DECISION_RECORDED", { decision: record });
    return clone(record);
  }

  record(type, payload = {}) {
    const item = { type, payload: clone(payload), timestamp: this.now().toISOString() };
    this.history.push(item);
    if (this.history.length > 500) this.history.shift();
    this.persist();
    return clone(item);
  }

  async flush() {
    await this.writeChain;
  }

  snapshot() {
    return {
      employeeId: this.employeeId,
      employeeType: this.employeeType,
      mission: clone(this.mission),
      memory: Object.fromEntries([...this.memory.entries()].map(([key, value]) => [key, clone(value)])),
      knowledge: Object.fromEntries([...this.knowledge.entries()].map(([key, value]) => [key, clone(value)])),
      history: clone(this.history),
      queue: clone(this.queue),
      decision: clone(this.decision),
      updatedAt: this.now().toISOString(),
    };
  }
}

export class EmployeeWorkspaceFactory {
  constructor({ memoryService = null, now = () => new Date() } = {}) {
    this.memoryService = memoryService;
    this.now = now;
  }

  create(employeeId, employeeType) {
    return new EmployeeWorkspace({ employeeId, employeeType, memoryService: this.memoryService, now: this.now });
  }
}
