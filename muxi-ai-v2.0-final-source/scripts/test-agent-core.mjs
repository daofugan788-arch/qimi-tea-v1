import assert from "node:assert/strict";
import { AgentCore } from "../js/agent/AgentCore.js";
import {
  ActionStatus,
  TASK_SCHEMA_VERSION,
  TaskStatus,
  isTerminalActionStatus,
  isTerminalTaskStatus,
} from "../js/agent/Task.js";

function action(id, status = ActionStatus.PENDING) {
  return {
    id,
    type: "show_message",
    params: { text: "测试" },
    requiresConfirmation: false,
    status,
  };
}

const events = [];
const agent = new AgentCore();
const unsubscribe = agent.subscribe((event) => events.push(event));

const task = agent.createTask({
  input: "测试 Agent Core",
  parsed: { intent: "test", label: "测试", source: "local_rule" },
  actions: [action("action-test-1")],
  riskLevel: "LOW",
  status: TaskStatus.PENDING,
});

assert.equal(task.schemaVersion, TASK_SCHEMA_VERSION);
assert.match(task.id, /^task-/);
assert.equal(task.status, TaskStatus.PENDING);
assert.equal(task.startedAt, null);
assert.equal(task.finishedAt, null);

// 对外读取必须是副本，不能绕过状态管理器修改内部任务。
task.status = TaskStatus.COMPLETED;
assert.equal(agent.getTask(task.id).status, TaskStatus.PENDING);

agent.transitionTask(task.id, TaskStatus.RUNNING);
agent.transitionAction(task.id, "action-test-1", ActionStatus.RUNNING);
agent.transitionAction(task.id, "action-test-1", ActionStatus.COMPLETED);
agent.transitionTask(task.id, TaskStatus.COMPLETED);

const completed = agent.getTask(task.id);
assert.equal(completed.status, TaskStatus.COMPLETED);
assert.equal(completed.actions[0].status, ActionStatus.COMPLETED);
assert.ok(completed.startedAt);
assert.ok(completed.finishedAt);
assert.equal(isTerminalTaskStatus(completed.status), true);
assert.equal(isTerminalActionStatus(completed.actions[0].status), true);
assert.throws(() => agent.transitionTask(task.id, TaskStatus.RUNNING), /不能从 completed/);

const confirmationTask = agent.createTask({
  input: "等待确认任务",
  parsed: { intent: "confirm", label: "等待确认", source: "local_rule" },
  actions: [action("action-test-2")],
  riskLevel: "MEDIUM",
  requiresConfirmation: true,
  status: TaskStatus.WAITING_CONFIRMATION,
});
assert.equal(agent.cancelTask(confirmationTask.id, "测试取消"), true);
const cancelled = agent.getTask(confirmationTask.id);
assert.equal(cancelled.status, TaskStatus.CANCELLED);
assert.equal(cancelled.actions[0].status, ActionStatus.CANCELLED);
assert.equal(cancelled.error, "测试取消");
assert.equal(agent.cancelTask(confirmationTask.id), false);

unsubscribe();
assert.ok(events.some((event) => event.type === "task_registered"));
assert.ok(events.some((event) => event.type === "task_status_changed" && event.status === TaskStatus.RUNNING));
assert.ok(events.some((event) => event.type === "action_status_changed" && event.status === ActionStatus.COMPLETED));

console.log(JSON.stringify({
  taskSchemaVersion: TASK_SCHEMA_VERSION,
  taskLifecycle: "passed",
  actionLifecycle: "passed",
  invalidTransitionBlocked: true,
  cancellation: "passed",
  immutableSnapshots: true,
  emittedEvents: events.length,
}, null, 2));
