import assert from "node:assert/strict";
import { ExecutionPlanStatus } from "../js/agent/ExecutionPlan.js";
import { StepStatus } from "../js/agent/Step.js";
import { FileOrganizerAgent } from "../js/agents/FileOrganizerAgent.js";
import { LocalProductivityAgent } from "../js/agents/LocalProductivityAgent.js";
import { AutomationEngine } from "../js/automation/AutomationEngine.js";
import { AutomationRepository } from "../js/automation/AutomationRepository.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  getItem(key) { return this.data.get(key) || null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
}

let remoteCallCount = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  remoteCallCount += 1;
  throw new Error("Sprint 09 Beta 测试禁止远程请求");
};

try {
  const repository = new AutomationRepository({
    storage: new MemoryStorage(),
    key: "test.v2.beta",
  });
  const engine = new AutomationEngine({ repository });
  const fileAgent = new FileOrganizerAgent({
    intentRouter: engine.intentRouter,
    planner: engine.agentPlanner,
    taskQueue: engine.taskQueue,
    executor: engine.agentExecutor,
    toolRegistry: engine.agentExecutor.toolRegistry,
  });
  const productivityAgent = new LocalProductivityAgent({
    intentRouter: engine.intentRouter,
    planner: engine.agentPlanner,
    taskQueue: engine.taskQueue,
    executor: engine.agentExecutor,
    toolRegistry: engine.agentExecutor.toolRegistry,
  });

  const queueEvents = [];
  const unsubscribe = engine.taskQueue.subscribe((event) => queueEvents.push(event));

  // Case 1：File Organizer Agent 完整链路及确认门槛。
  const fileRequest = "帮我整理下载目录";
  const fileRoute = engine.recognizeIntent(fileRequest);
  assert.equal(fileRoute.matched, true);
  assert.equal(fileRoute.intent, "file_organizer_agent");
  assert.equal(fileRoute.toolName, "file_tool");

  const files = [
    { id: "f1", name: "产品图.png", size: 2048, type: "image/png" },
    { id: "f2", name: "需求说明.pdf", size: 4096, type: "application/pdf" },
    { id: "f3", name: "发布包.zip", size: 8192, type: "application/zip" },
  ];
  const filesBeforeRun = JSON.parse(JSON.stringify(files));
  const fileOutput = await fileAgent.preview({ request: fileRequest, directory: "Download", files });
  assert.equal(fileOutput.plan.intent, "file_organizer_agent");
  assert.equal(fileOutput.plan.status, ExecutionPlanStatus.WAITING_CONFIRMATION);
  assert.deepEqual(fileOutput.plan.steps.map((step) => step.status), [
    StepStatus.SUCCESS,
    StepStatus.SUCCESS,
    StepStatus.WAITING_CONFIRMATION,
  ]);
  assert.equal(fileOutput.requiresConfirmation, true);
  assert.equal(fileOutput.actualFileOperationExecuted, false);
  assert.equal(fileOutput.preview.fileCount, files.length);
  assert.ok(fileOutput.preview.proposedMoves.every((move) => move.willExecute === false));
  assert.deepEqual(files, filesBeforeRun);

  const fileExecutedTaskIds = fileOutput.plan.steps.slice(0, 2).map((step) => step.taskId);
  for (const taskId of fileExecutedTaskIds) {
    assert.ok(queueEvents.some((event) => event.type === "queue_item_enqueued" && event.taskId === taskId));
    assert.equal(engine.getTaskExecution(taskId).status, "success");
  }
  const fileConfirmed = await fileAgent.confirm(fileOutput.plan.id);
  assert.equal(fileConfirmed.plan.status, ExecutionPlanStatus.SUCCESS);
  assert.equal(fileConfirmed.confirmationRecorded, true);
  assert.equal(fileConfirmed.actualFileOperationExecuted, false);
  assert.equal(fileConfirmed.plan.steps[2].result.executed, false);

  // Case 2：内容助手使用确定性本地模板返回产品介绍草稿。
  const contentRequest = "帮我生成一篇产品介绍文案";
  const contentRoute = engine.recognizeIntent(contentRequest);
  assert.equal(contentRoute.matched, true);
  assert.equal(contentRoute.intent, "content_assistant");
  assert.equal(contentRoute.toolName, "local_productivity_tool");

  const contentOutput = await productivityAgent.runContent({
    request: contentRequest,
    productName: "暮曦 AI",
    highlights: ["本地优先", "任务可确认", "数据由用户掌控"],
  });
  assert.equal(contentOutput.plan.status, ExecutionPlanStatus.SUCCESS);
  assert.equal(contentOutput.plan.intent, "content_assistant");
  assert.equal(contentOutput.plan.steps.length, 1);
  assert.equal(contentOutput.plan.steps[0].status, StepStatus.SUCCESS);
  assert.equal(contentOutput.completed, true);
  assert.match(contentOutput.result.title, /暮曦 AI/);
  assert.match(contentOutput.result.content, /本地优先/);
  assert.equal(contentOutput.result.templateBased, true);
  assert.equal(contentOutput.result.remoteModelUsed, false);
  assert.equal(engine.getTaskExecution(contentOutput.plan.steps[0].taskId).status, "success");

  // Case 3：商业助手先规范化，再按本地规则分类客户跟进记录。
  const customerRequest = "帮我整理客户跟进记录";
  const customerRoute = engine.recognizeIntent(customerRequest);
  assert.equal(customerRoute.matched, true);
  assert.equal(customerRoute.intent, "customer_follow_up_assistant");
  assert.equal(customerRoute.toolName, "local_productivity_tool");

  const customerRecords = [
    { id: "c1", customer: "星海商贸", note: "今天尽快回访，客户对基础版有意向" },
    { id: "c2", customer: "远山设计", note: "已经签约成交" },
    { id: "c3", customer: "青禾工作室", note: "暂缓采购，以后再联系" },
    { id: "c4", customer: "南风门店", note: "首次接触，尚无结论" },
  ];
  const customerRecordsBeforeRun = JSON.parse(JSON.stringify(customerRecords));
  const customerOutput = await productivityAgent.runCustomer({
    request: customerRequest,
    records: customerRecords,
  });
  assert.equal(customerOutput.plan.status, ExecutionPlanStatus.SUCCESS);
  assert.equal(customerOutput.plan.intent, "customer_follow_up_assistant");
  assert.equal(customerOutput.plan.steps.length, 2);
  assert.deepEqual(customerOutput.plan.steps[1].dependsOn, [customerOutput.plan.steps[0].id]);
  assert.deepEqual(customerOutput.plan.steps.map((step) => step.status), [
    StepStatus.SUCCESS,
    StepStatus.SUCCESS,
  ]);
  assert.equal(customerOutput.completed, true);
  assert.deepEqual(customerOutput.result.summary, {
    "待跟进": 1,
    "已成交": 1,
    "暂缓": 1,
    "未分类": 1,
  });
  assert.equal(customerOutput.result.categories["待跟进"][0].priority, "HIGH");
  assert.equal(customerOutput.result.persisted, false);
  assert.equal(customerOutput.result.remoteModelUsed, false);
  assert.deepEqual(customerRecords, customerRecordsBeforeRun);
  for (const step of customerOutput.plan.steps) {
    assert.equal(engine.getTaskExecution(step.taskId).status, "success");
  }

  assert.equal(engine.taskQueue.getSnapshot().isProcessing, false);
  assert.equal(engine.taskQueue.getSnapshot().pending.length, 0);
  assert.equal(remoteCallCount, 0);
  assert.ok(engine.agentExecutor.hasTool("automation"));
  assert.ok(engine.agentExecutor.hasTool("file_tool"));
  assert.ok(engine.agentExecutor.hasTool("local_productivity_tool"));
  unsubscribe();

  console.log(JSON.stringify({
    suite: "暮曦 AI muxi-ai-v2.0-final Sprint 09 Beta",
    cases: {
      fileOrganizer: {
        intentRecognized: true,
        planSteps: fileOutput.plan.steps.length,
        queueWorked: true,
        executorWorked: true,
        confirmationRequired: true,
        confirmationRecorded: fileConfirmed.confirmationRecorded,
        actualFileOperationExecuted: false,
      },
      contentAssistant: {
        intentRecognized: true,
        planSteps: contentOutput.plan.steps.length,
        resultReturned: Boolean(contentOutput.result?.content),
        templateBased: true,
      },
      businessAssistant: {
        intentRecognized: true,
        planSteps: customerOutput.plan.steps.length,
        classifiedRecords: customerOutput.result.total,
        summary: customerOutput.result.summary,
        inputDataUnchanged: true,
      },
    },
    queueEventCount: queueEvents.length,
    queueIdle: true,
    remoteCallCount,
    existingAutomationToolPreserved: true,
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}
