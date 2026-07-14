import assert from "node:assert/strict";
import { AgentExecutor, ExecutorStatus } from "../js/agent/AgentExecutor.js";
import {
  ToolPermissionCode,
  ToolPermissionError,
  ToolRegistry,
  ToolRiskLevel,
} from "../js/tools/ToolRegistry.js";

const calls = [];
const registry = new ToolRegistry();
registry.register({
  name: "format_text",
  type: "utility",
  description: "格式化一段测试文本",
  parameters: {
    text: { type: "string", required: true, description: "待处理文本" },
    uppercase: { type: "boolean", required: false, description: "是否转为大写", default: false },
  },
  enabled: true,
  riskLevel: ToolRiskLevel.LOW,
  execute(task, { params }) {
    calls.push("format_text");
    return { text: params.uppercase ? params.text.toUpperCase() : params.text, taskId: task.id };
  },
});

// 工具名称、类型、描述、参数定义和风险等级可以读取，但不会泄露 execute 函数。
const metadata = registry.get("format_text");
assert.equal(metadata.name, "format_text");
assert.equal(metadata.type, "utility");
assert.equal(metadata.description, "格式化一段测试文本");
assert.equal(metadata.parameters.text.type, "string");
assert.equal(metadata.parameters.text.required, true);
assert.equal(metadata.enabled, true);
assert.equal(metadata.riskLevel, ToolRiskLevel.LOW);
assert.equal(Object.prototype.hasOwnProperty.call(metadata, "execute"), false);
metadata.enabled = false;
assert.equal(registry.get("format_text").enabled, true);

// 参数定义校验。
assert.equal(registry.validateParameters("format_text", { text: "hello", uppercase: true }).valid, true);
assert.equal(registry.validateParameters("format_text", {}).valid, false);
assert.match(registry.validateParameters("format_text", { text: 123 }).errors[0], /string/);

// LOW 允许；禁用工具拒绝；MEDIUM 需要确认；HIGH 始终阻止。
assert.equal(registry.checkPermission("format_text", { params: { text: "hello" } }).code, ToolPermissionCode.ALLOWED);
registry.setEnabled("format_text", false);
assert.equal(registry.checkPermission("format_text", { params: { text: "hello" } }).code, ToolPermissionCode.TOOL_DISABLED);
registry.setEnabled("format_text", true);
registry.setRiskLevel("format_text", ToolRiskLevel.MEDIUM);
assert.equal(registry.checkPermission("format_text", { params: { text: "hello" } }).code, ToolPermissionCode.CONFIRMATION_REQUIRED);
assert.equal(registry.checkPermission("format_text", { confirmed: true, params: { text: "hello" } }).code, ToolPermissionCode.ALLOWED);
registry.setRiskLevel("format_text", ToolRiskLevel.HIGH);
assert.equal(registry.checkPermission("format_text", { confirmed: true, params: { text: "hello" } }).code, ToolPermissionCode.HIGH_RISK_BLOCKED);
await assert.rejects(
  () => registry.execute("format_text", { id: "task-direct" }, { confirmed: true, params: { text: "hello" } }),
  (error) => error instanceof ToolPermissionError && error.code === ToolPermissionCode.HIGH_RISK_BLOCKED,
);
assert.equal(calls.length, 0);
registry.setRiskLevel("format_text", ToolRiskLevel.LOW);

// Executor 必须先通过 ToolRegistry 权限检查，未通过时不能调用工具。
registry.register({
  name: "disabled_tool",
  type: "test",
  description: "禁用工具测试",
  enabled: false,
  riskLevel: ToolRiskLevel.LOW,
  execute() { calls.push("disabled_tool"); return { ok: true }; },
});
registry.register({
  name: "medium_tool",
  type: "test",
  description: "确认测试",
  enabled: true,
  riskLevel: ToolRiskLevel.MEDIUM,
  execute() { calls.push("medium_tool"); return { ok: true }; },
});
registry.register({
  name: "high_tool",
  type: "test",
  description: "高风险阻止测试",
  enabled: true,
  riskLevel: ToolRiskLevel.HIGH,
  execute() { calls.push("high_tool"); return { ok: true }; },
});

const tasks = new Map([
  ["task-format", { id: "task-format", kind: "format_text", metadata: { toolParams: { text: "hello", uppercase: true } } }],
  ["task-invalid", { id: "task-invalid", kind: "format_text", metadata: { toolParams: {} } }],
  ["task-disabled", { id: "task-disabled", kind: "disabled_tool", metadata: {} }],
  ["task-medium", { id: "task-medium", kind: "medium_tool", metadata: {} }],
  ["task-high", { id: "task-high", kind: "high_tool", metadata: {} }],
]);
const executor = new AgentExecutor({
  getTask: (taskId) => tasks.get(taskId) || null,
  toolRegistry: registry,
});

const success = await executor.executeTask("task-format");
assert.equal(success.status, ExecutorStatus.SUCCESS);
assert.equal(success.output.text, "HELLO");
const invalid = await executor.executeTask("task-invalid");
assert.equal(invalid.status, ExecutorStatus.FAILED);
assert.equal(invalid.output.permission.code, ToolPermissionCode.INVALID_PARAMETERS);
const disabled = await executor.executeTask("task-disabled");
assert.equal(disabled.status, ExecutorStatus.FAILED);
assert.equal(disabled.output.permission.code, ToolPermissionCode.TOOL_DISABLED);
const mediumDenied = await executor.executeTask("task-medium");
assert.equal(mediumDenied.status, ExecutorStatus.FAILED);
assert.equal(mediumDenied.output.permission.code, ToolPermissionCode.CONFIRMATION_REQUIRED);
const mediumAllowed = await executor.executeTask("task-medium", { confirmed: true });
assert.equal(mediumAllowed.status, ExecutorStatus.SUCCESS);
const high = await executor.executeTask("task-high", { confirmed: true });
assert.equal(high.status, ExecutorStatus.FAILED);
assert.equal(high.output.permission.code, ToolPermissionCode.HIGH_RISK_BLOCKED);
assert.equal(calls.includes("disabled_tool"), false);
assert.equal(calls.includes("high_tool"), false);

console.log(JSON.stringify({
  metadata: "passed",
  parameterDefinitions: "passed",
  enableDisable: "passed",
  riskLevels: Object.values(ToolRiskLevel),
  lowAllowed: true,
  mediumRequiresConfirmation: true,
  highBlocked: true,
  executorPermissionCheck: "passed",
  registeredTools: registry.list().length,
}, null, 2));
