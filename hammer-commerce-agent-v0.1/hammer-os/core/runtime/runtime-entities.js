import { MISSION_STATUS, TASK_STATUS } from "./runtime-status.js";

function id(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export function createMission(input = {}) {
  const now = new Date().toISOString();
  return {
    id: input.id || id("MSN"),
    type: String(input.type || "").trim(),
    goal: String(input.goal || "").trim(),
    priority: Math.max(0, Number(input.priority) || 0),
    input: input.input || {},
    metadata: input.metadata || {},
    status: MISSION_STATUS.WAITING,
    tasks: [],
    results: {},
    events: [],
    error: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
  };
}

export function createRuntimeTask(definition = {}, mission, index = 0) {
  return {
    id: definition.id || id("TSK"),
    missionId: mission.id,
    title: definition.title || `Task ${index + 1}`,
    agentType: String(definition.agentType || "").trim(),
    input: definition.input || {},
    priority: Number.isFinite(Number(definition.priority)) ? Number(definition.priority) : mission.priority,
    dependsOn: [...(definition.dependsOn || [])],
    runAt: definition.runAt || null,
    maxRetries: Math.max(0, Number(definition.maxRetries) || 0),
    retryDelayMs: Math.max(0, Number(definition.retryDelayMs) || 0),
    attempts: 0,
    status: TASK_STATUS.WAITING,
    output: null,
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
  };
}
