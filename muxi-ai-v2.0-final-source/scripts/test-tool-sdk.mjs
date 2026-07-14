import assert from "node:assert/strict";
import { AgentExecutor, ExecutorStatus } from "../js/agent/AgentExecutor.js";
import { TaskQueue } from "../js/agent/TaskQueue.js";
import { Tool, ToolRiskLevel, assertToolContract } from "../js/tools/Tool.js";
import { ToolRegistry } from "../js/tools/ToolRegistry.js";
import { EchoTool } from "../js/tools/examples/EchoTool.js";

const echoTool = new EchoTool();
assert.equal(assertToolContract(echoTool), true);
assert.ok(echoTool instanceof Tool);
assert.equal(echoTool.name, "echo");
assert.equal(echoTool.type, "sdk_example");
assert.equal(typeof echoTool.description, "string");
assert.equal(echoTool.riskLevel, ToolRiskLevel.LOW);
assert.equal(echoTool.paramsSchema.text.required, true);
assert.equal(typeof echoTool.validate, "function");
assert.equal(typeof echoTool.execute, "function");
assert.equal(typeof echoTool.cancel, "function");

assert.throws(
  () => assertToolContract({
    name: "invalid",
    type: "test",
    description: "缺少 cancel",
    riskLevel: ToolRiskLevel.LOW,
    paramsSchema: {},
    validate() { return { valid: true, errors: [] }; },
    execute() {},
  }),
  /cancel/,
);

const registry = new ToolRegistry();
registry.register(echoTool);
const metadata = registry.get("echo");
assert.equal(metadata.name, "echo");
assert.equal(metadata.type, "sdk_example");
assert.equal(metadata.paramsSchema.text.type, "string");
assert.equal(metadata.riskLevel, ToolRiskLevel.LOW);
assert.equal(registry.validateParameters("echo", { text: "暮曦" }).valid, true);
assert.equal(registry.validateParameters("echo", {}).valid, false);

const tasks = new Map([
  ["task-echo", {
    id: "task-echo",
    kind: "echo",
    status: "pending",
    requiresConfirmation: false,
    metadata: { toolParams: { text: "暮曦 Tool SDK" } },
  }],
  ["task-cancel", {
    id: "task-cancel",
    kind: "echo",
    status: "pending",
    requiresConfirmation: false,
    metadata: { toolParams: { text: "不会输出" } },
  }],
]);
const executor = new AgentExecutor({
  getTask: (taskId) => tasks.get(taskId) || null,
  toolRegistry: registry,
});
const queue = new TaskQueue({
  getTask: (taskId) => tasks.get(taskId) || null,
  runTask: (taskId, context) => executor.executeFromQueue(taskId, context),
});

// 完整链路：TaskQueue -> AgentExecutor -> ToolRegistry -> EchoTool。
queue.enqueue("task-echo");
const run = await queue.start();
assert.equal(run.processed, 1);
assert.equal(run.succeeded, 1);
assert.equal(run.results[0].status, ExecutorStatus.SUCCESS);
assert.equal(executor.getExecution("task-echo").output.text, "暮曦 Tool SDK");

// cancel() 通过 Executor 对接到具体 Tool。
const cancelResult = await executor.cancelExecution("task-cancel");
assert.equal(cancelResult.cancelled, true);
const cancelledExecution = await executor.executeTask("task-cancel");
assert.equal(cancelledExecution.status, ExecutorStatus.CANCELLED);
assert.equal(cancelledExecution.output.status, "cancelled");
assert.ok(cancelledExecution.finishedAt);

// 旧函数式工具仍会被包装为完整 Tool，避免破坏 Sprint 03/04。
const legacyTasks = new Map([
  ["task-legacy", { id: "task-legacy", kind: "legacy", metadata: { toolParams: {} } }],
]);
const legacyExecutor = new AgentExecutor({ getTask: (taskId) => legacyTasks.get(taskId) || null });
legacyExecutor.registerTool("legacy", () => ({ ok: true }));
const legacyResult = await legacyExecutor.executeTask("task-legacy");
assert.equal(legacyResult.status, ExecutorStatus.SUCCESS);
assert.equal(legacyExecutor.getTools()[0].name, "legacy");
assert.equal(typeof legacyExecutor.toolRegistry.requireRecord("legacy").tool.validate, "function");
assert.equal(typeof legacyExecutor.toolRegistry.requireRecord("legacy").tool.cancel, "function");

console.log(JSON.stringify({
  toolContract: ["name", "type", "description", "riskLevel", "paramsSchema", "validate", "execute", "cancel"],
  sdkContractValidation: "passed",
  registryIntegration: "passed",
  executorIntegration: "passed",
  queueExecutionChain: "passed",
  cancellation: "passed",
  minimalExampleTool: "echo",
  legacyCompatibility: "passed",
}, null, 2));
