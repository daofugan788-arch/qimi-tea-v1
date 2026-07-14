import assert from "node:assert/strict";
import { AgentExecutor, ExecutorStatus } from "../js/agent/AgentExecutor.js";
import { TaskQueue } from "../js/agent/TaskQueue.js";
import { AutomationEngine } from "../js/automation/AutomationEngine.js";
import { AutomationRepository } from "../js/automation/AutomationRepository.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.get(key) || null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}

function localTask(id, kind, input) {
  return {
    id,
    kind,
    input,
    status: "pending",
    requiresConfirmation: false,
  };
}

const tasks = new Map([
  ["task-text", localTask("task-text", "text_tool", "你好")],
  ["task-number", localTask("task-number", "number_tool", "21")],
  ["task-unknown", localTask("task-unknown", "unknown_tool", "未知")],
  ["task-error", localTask("task-error", "error_tool", "失败")],
]);
const toolCalls = [];
const statusEvents = [];
const executor = new AgentExecutor({ getTask: (taskId) => tasks.get(taskId) || null });
executor.registerTool("text_tool", (task) => {
  toolCalls.push(task.kind);
  return { text: `已处理：${task.input}` };
});
executor.registerTool("number_tool", {
  execute(task) {
    toolCalls.push(task.kind);
    return { value: Number(task.input) * 2 };
  },
});
executor.registerTool("error_tool", () => {
  toolCalls.push("error_tool");
  throw new Error("模拟工具失败");
});
const unsubscribe = executor.subscribe((event) => statusEvents.push(event));

// TaskQueue 将任务 ID 交给 AgentExecutor，Executor 再按 Task.kind 调用对应工具。
const queue = new TaskQueue({
  getTask: (taskId) => tasks.get(taskId) || null,
  runTask: (taskId, context) => executor.executeFromQueue(taskId, context),
});
queue.enqueue("task-text");
queue.enqueue("task-number");
const queueRun = await queue.start();
assert.equal(queueRun.processed, 2);
assert.equal(queueRun.succeeded, 2);
assert.deepEqual(queueRun.results.map((item) => item.status), ["success", "success"]);
assert.deepEqual(toolCalls.slice(0, 2), ["text_tool", "number_tool"]);
assert.equal(executor.getExecution("task-text").output.text, "已处理：你好");
assert.equal(executor.getExecution("task-number").output.value, 42);

// 未注册的任务类型和工具异常都统一返回 failed，不让异常冲垮队列。
const unknownResult = await executor.executeTask("task-unknown");
assert.equal(unknownResult.status, ExecutorStatus.FAILED);
assert.match(unknownResult.error, /未找到任务类型/);
const errorResult = await executor.executeTask("task-error");
assert.equal(errorResult.status, ExecutorStatus.FAILED);
assert.equal(errorResult.error, "模拟工具失败");
const missingResult = await executor.executeTask("task-missing");
assert.equal(missingResult.status, ExecutorStatus.FAILED);
assert.equal(missingResult.error, "任务不存在或已经失效");

// 对外读取是副本，不能修改 Executor 内部执行状态。
const externalExecution = executor.getExecution("task-text");
externalExecution.status = ExecutorStatus.FAILED;
assert.equal(executor.getExecution("task-text").status, ExecutorStatus.SUCCESS);
assert.deepEqual(executor.getToolTypes().sort(), ["error_tool", "number_tool", "text_tool"]);

// 验证实际 AutomationEngine 队列已经通过 AgentExecutor 分派 automation 工具。
const repository = new AutomationRepository({
  storage: new MemoryStorage(),
  key: "test.agent.executor",
});
const webActions = [];
const automation = new AutomationEngine({
  repository,
  executor: {
    async execute(action) {
      webActions.push(action.type);
      return { status: "completed", message: "本地网页动作完成" };
    },
  },
});
const automationTask = automation.createTask("打开设置");
automation.enqueueTask(automationTask.id);
const automationRun = await automation.runTaskQueue();
assert.equal(automationRun.succeeded, 1);
assert.equal(automationRun.results[0].status, ExecutorStatus.SUCCESS);
assert.equal(automation.getTask(automationTask.id).status, "completed");
assert.equal(automation.getTaskExecution(automationTask.id).status, ExecutorStatus.SUCCESS);
assert.deepEqual(webActions, ["navigate", "show_message"]);

unsubscribe();
for (const taskId of ["task-text", "task-number", "task-unknown", "task-error", "task-missing"]) {
  const statuses = statusEvents.filter((event) => event.taskId === taskId).map((event) => event.status);
  assert.equal(statuses[0], ExecutorStatus.PENDING);
  if (taskId !== "task-missing") assert.ok(statuses.includes(ExecutorStatus.RUNNING));
  assert.ok([ExecutorStatus.SUCCESS, ExecutorStatus.FAILED].includes(statuses.at(-1)));
}

console.log(JSON.stringify({
  queueTaskReading: "passed",
  taskTypeDispatch: toolCalls.slice(0, 2),
  statuses: Object.values(ExecutorStatus),
  successResult: "passed",
  missingToolFailure: "passed",
  toolErrorFailure: "passed",
  automationIntegration: "passed",
  immutableExecutionSnapshots: true,
  executorEvents: statusEvents.length,
}, null, 2));
