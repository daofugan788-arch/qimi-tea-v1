import assert from "node:assert/strict";
import { FileOrganizerAgent } from "../js/agents/FileOrganizerAgent.js";
import { ExecutionPlanStatus } from "../js/agent/ExecutionPlan.js";
import { StepStatus } from "../js/agent/Step.js";
import { AutomationEngine } from "../js/automation/AutomationEngine.js";
import { AutomationRepository } from "../js/automation/AutomationRepository.js";
import { FileToolOperation } from "../js/tools/FileTool.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.get(key) || null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}

const repository = new AutomationRepository({
  storage: new MemoryStorage(),
  key: "test.file.organizer.agent",
});
const engine = new AutomationEngine({ repository });
const agent = new FileOrganizerAgent({
  intentRouter: engine.intentRouter,
  planner: engine.agentPlanner,
  taskQueue: engine.taskQueue,
  executor: engine.agentExecutor,
  toolRegistry: engine.agentExecutor.toolRegistry,
});

const originalFiles = [
  { id: "f1", name: "旅行照片.jpg", size: 2048, type: "image/jpeg" },
  { id: "f2", name: "工作报告.pdf", size: 4096, type: "application/pdf" },
  { id: "f3", name: "暮曦源码.zip", size: 8192, type: "application/zip" },
  { id: "f4", name: "安装包.apk", size: 16384, type: "application/vnd.android.package-archive" },
  { id: "f5", name: "../备忘录.txt", size: 512, type: "text/plain" },
];
const untouchedFiles = JSON.parse(JSON.stringify(originalFiles));

// ToolRegistry、Intent Router 和 Planner 均已注册 File Organizer 能力。
const toolMetadata = engine.agentExecutor.toolRegistry.get("file_tool");
assert.equal(toolMetadata.name, "file_tool");
assert.equal(toolMetadata.type, "local_file_preview");
assert.equal(toolMetadata.riskLevel, "LOW");
assert.equal(toolMetadata.enabled, true);
assert.ok(engine.intentRouter.getRules().some((rule) => rule.toolName === "file_tool"));
assert.ok(engine.agentPlanner.getRules().some((rule) => rule.intent === "file_organizer_agent"));

// 输出完整 Execution Plan：Step2 依赖 Step1，Step3 依赖 Step2。
const createdPlan = agent.createPlan({
  request: "帮我整理下载目录",
  directory: "Download",
  files: originalFiles,
});
assert.equal(createdPlan.status, ExecutionPlanStatus.PENDING);
assert.equal(createdPlan.intent, "file_organizer_agent");
assert.equal(createdPlan.steps.length, 3);
assert.deepEqual(createdPlan.steps[1].dependsOn, [createdPlan.steps[0].id]);
assert.deepEqual(createdPlan.steps[2].dependsOn, [createdPlan.steps[1].id]);
assert.ok(createdPlan.steps.every((step) => step.toolName === "file_tool"));
assert.deepEqual(createdPlan.steps.map((step) => step.params.operation), [
  FileToolOperation.SCAN_PREVIEW,
  FileToolOperation.ORGANIZE_PREVIEW,
  FileToolOperation.CONFIRM_PREVIEW,
]);

// 完整预览链路：Router -> Planner -> TaskQueue -> Executor -> ToolRegistry -> FileTool。
const previewOutput = await agent.preview({
  request: "帮我整理下载目录",
  directory: "Download",
  files: originalFiles,
});
const previewPlan = previewOutput.plan;
assert.equal(previewPlan.status, ExecutionPlanStatus.WAITING_CONFIRMATION);
assert.deepEqual(previewPlan.steps.map((step) => step.status), [
  StepStatus.SUCCESS,
  StepStatus.SUCCESS,
  StepStatus.WAITING_CONFIRMATION,
]);
assert.equal(previewOutput.requiresConfirmation, true);
assert.equal(previewOutput.actualFileOperationExecuted, false);
assert.equal(previewOutput.preview.operation, FileToolOperation.ORGANIZE_PREVIEW);
assert.equal(previewOutput.preview.fileCount, originalFiles.length);
assert.equal(previewOutput.preview.executed, false);
assert.equal(previewOutput.preview.proposedMoves.length, originalFiles.length);
assert.ok(previewOutput.preview.proposedMoves.every((move) => move.willExecute === false));
assert.ok(previewOutput.preview.groups["图片"].some((file) => file.name === "旅行照片.jpg"));
assert.ok(previewOutput.preview.groups["文档"].some((file) => file.name === "工作报告.pdf"));
assert.ok(previewOutput.preview.groups["压缩包"].some((file) => file.name === "暮曦源码.zip"));
assert.ok(previewOutput.preview.groups["安装包"].some((file) => file.name === "安装包.apk"));
assert.ok(previewOutput.preview.groups["文档"].some((file) => file.name === "备忘录.txt"));

const firstExecution = engine.agentExecutor.getExecution(previewPlan.steps[0].taskId);
const secondExecution = engine.agentExecutor.getExecution(previewPlan.steps[1].taskId);
assert.equal(firstExecution.status, "success");
assert.equal(secondExecution.status, "success");
assert.equal(engine.taskQueue.getSnapshot().isProcessing, false);

// 用户确认后只记录确认，不执行移动、覆盖或删除。
const confirmedOutput = await agent.confirm(previewPlan.id);
assert.equal(confirmedOutput.plan.status, ExecutionPlanStatus.SUCCESS);
assert.deepEqual(confirmedOutput.plan.steps.map((step) => step.status), [
  StepStatus.SUCCESS,
  StepStatus.SUCCESS,
  StepStatus.SUCCESS,
]);
assert.equal(confirmedOutput.confirmationRecorded, true);
assert.equal(confirmedOutput.actualFileOperationExecuted, false);
const confirmationResult = confirmedOutput.plan.steps[2].result;
assert.equal(confirmationResult.operation, FileToolOperation.CONFIRM_PREVIEW);
assert.equal(confirmationResult.confirmationRecorded, true);
assert.equal(confirmationResult.executed, false);
assert.ok(confirmationResult.proposedMoves.every((move) => move.willExecute === false));

// 输入数组保持不变，证明 Agent 没有修改用户提供的数据。
assert.deepEqual(originalFiles, untouchedFiles);

console.log(JSON.stringify({
  agent: "File Organizer Agent",
  fullChain: [
    "IntentRouter",
    "AgentPlanner",
    "TaskQueue",
    "AgentExecutor",
    "ToolRegistry",
    "FileTool",
  ],
  planSteps: createdPlan.steps.length,
  dependencyChain: "Step1 -> Step2 -> Step3",
  previewGenerated: true,
  previewFileCount: previewOutput.preview.fileCount,
  categories: Object.keys(previewOutput.preview.groups),
  confirmationRequired: true,
  confirmationRecorded: confirmedOutput.confirmationRecorded,
  actualFileOperationExecuted: false,
  userInputUnchanged: true,
  remoteModelUsed: false,
}, null, 2));
