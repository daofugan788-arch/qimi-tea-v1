import { ExecutionPlanStatus } from "../agent/ExecutionPlan.js";
import { StepStatus } from "../agent/Step.js";
import { FileTool, FileToolOperation } from "../tools/FileTool.js";
import { ToolRiskLevel } from "../tools/Tool.js";

const ROUTE_RULE_ID = "route-file-organizer-tool";
const REQUEST_ROUTE_RULE_ID = "route-file-organizer-request";
const PLANNER_RULE_ID = "plan-file-organizer-agent";

function safeDirectory(value) {
  return String(value || "Download")
    .replace(/\u0000/g, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1) || "Download";
}

// 第一个完整业务 Agent。复用既有 Router、Planner、Queue、Executor 和 Registry。
export class FileOrganizerAgent {
  constructor({ intentRouter, planner, taskQueue, executor, toolRegistry, fileTool } = {}) {
    if (!intentRouter || typeof intentRouter.registerRule !== "function") throw new Error("FileOrganizerAgent 需要 IntentRouter");
    if (!planner || typeof planner.registerRule !== "function" || typeof planner.createPlan !== "function") {
      throw new Error("FileOrganizerAgent 需要 AgentPlanner");
    }
    if (!taskQueue || typeof taskQueue.start !== "function") throw new Error("FileOrganizerAgent 需要 TaskQueue");
    if (!executor || typeof executor.getExecution !== "function") throw new Error("FileOrganizerAgent 需要 AgentExecutor");
    this.toolRegistry = toolRegistry || executor.toolRegistry;
    if (!this.toolRegistry || typeof this.toolRegistry.register !== "function") {
      throw new Error("FileOrganizerAgent 需要 ToolRegistry");
    }

    this.intentRouter = intentRouter;
    this.planner = planner;
    this.taskQueue = taskQueue;
    this.executor = executor;
    this.fileTool = fileTool || new FileTool();
    this.registerTool();
    this.registerIntentRoute();
    this.registerPlannerRule();
  }

  registerTool() {
    if (!this.toolRegistry.has(this.fileTool.name)) this.toolRegistry.register(this.fileTool);
    return this.toolRegistry.get(this.fileTool.name);
  }

  registerIntentRoute() {
    const registeredRuleIds = new Set(this.intentRouter.getRules().map((rule) => rule.id));
    if (!registeredRuleIds.has(ROUTE_RULE_ID)) {
      this.intentRouter.registerRule({
        id: ROUTE_RULE_ID,
        intent: "file_organizer_step",
        toolName: this.fileTool.name,
        description: "将 File Organizer Agent 的内部步骤路由到 File Tool",
        priority: 300,
        patterns: [/^文件整理步骤：(scan_preview|organize_preview|confirm_preview)$/i],
        extractParams: ({ match }) => ({ operation: match[1].toLowerCase() }),
      });
    }
    if (!registeredRuleIds.has(REQUEST_ROUTE_RULE_ID)) {
      this.intentRouter.registerRule({
        id: REQUEST_ROUTE_RULE_ID,
        intent: "file_organizer_agent",
        toolName: this.fileTool.name,
        description: "识别文件整理请求并交给 File Organizer Agent 生成预览计划",
        priority: 280,
        patterns: [/(?:帮我|请)?整理(?:一下)?(?:手机)?下载目录/i, /整理.*download/i],
        extractParams: () => ({
          operation: FileToolOperation.ORGANIZE_PREVIEW,
          directory: "Download",
          files: [],
        }),
      });
    }
  }

  registerPlannerRule() {
    if (this.planner.getRules().some((rule) => rule.id === PLANNER_RULE_ID)) return;
    this.planner.registerRule({
      id: PLANNER_RULE_ID,
      intent: "file_organizer_agent",
      description: "生成文件清单预览、分类预览和用户确认三个步骤",
      priority: 300,
      patterns: [/(?:帮我|请)?整理(?:一下)?(?:手机)?下载目录/i, /整理.*download/i],
      buildSteps: ({ metadata = {} }) => {
        const directory = safeDirectory(metadata.directory);
        const files = this.fileTool.normalizeFiles(metadata.files);
        return [
          {
            key: "scan",
            name: "读取用户提供的文件清单",
            description: "只读取用户主动提供的文件名称、大小和类型，不访问 Android 文件系统。",
            input: `文件整理步骤：${FileToolOperation.SCAN_PREVIEW}`,
            params: { operation: FileToolOperation.SCAN_PREVIEW, directory, files },
          },
          {
            key: "preview",
            name: "生成文件分类预览",
            description: "根据扩展名生成拟整理路径，不移动、不覆盖、不删除文件。",
            input: `文件整理步骤：${FileToolOperation.ORGANIZE_PREVIEW}`,
            params: { operation: FileToolOperation.ORGANIZE_PREVIEW, directory, files },
            dependsOn: ["scan"],
          },
          {
            key: "confirm",
            name: "确认文件整理预览",
            description: "必须由用户确认；确认后也只记录结果，当前版本不移动文件。",
            input: `文件整理步骤：${FileToolOperation.CONFIRM_PREVIEW}`,
            params: { operation: FileToolOperation.CONFIRM_PREVIEW, directory, files },
            riskLevel: ToolRiskLevel.MEDIUM,
            requiresConfirmation: true,
            dependsOn: ["preview"],
          },
        ];
      },
    });
  }

  createPlan({ request = "帮我整理下载目录", directory = "Download", files = [] } = {}) {
    const normalizedFiles = this.fileTool.normalizeFiles(files);
    return this.planner.createPlan(request, {
      metadata: {
        agent: "file_organizer",
        directory: safeDirectory(directory),
        files: normalizedFiles,
        previewOnly: true,
      },
    });
  }

  getPlan(planId) {
    return this.planner.getPlan(planId);
  }

  buildOutput(plan) {
    const previewStep = plan.steps.find((step) => step.metadata?.sourceKey === "preview");
    const confirmationStep = plan.steps.find((step) => step.metadata?.sourceKey === "confirm");
    return {
      agent: "file_organizer",
      plan,
      preview: previewStep?.result || null,
      requiresConfirmation: plan.status === ExecutionPlanStatus.WAITING_CONFIRMATION,
      confirmationRecorded: confirmationStep?.status === StepStatus.SUCCESS,
      actualFileOperationExecuted: false,
    };
  }

  async preview(options = {}) {
    const created = this.createPlan(options);
    const plan = await this.planner.executePlan(created.id);
    return this.buildOutput(plan);
  }

  async confirm(planId) {
    const current = this.planner.getPlan(planId);
    if (!current || current.metadata?.agent !== "file_organizer") {
      throw new Error("File Organizer Execution Plan 不存在");
    }
    const confirmationStepIds = current.steps
      .filter((step) => step.status === StepStatus.WAITING_CONFIRMATION)
      .map((step) => step.id);
    if (!confirmationStepIds.length) throw new Error("当前文件整理计划不需要确认");
    const plan = await this.planner.executePlan(planId, { confirmedStepIds: confirmationStepIds });
    return this.buildOutput(plan);
  }
}

export {
  ROUTE_RULE_ID as FILE_ORGANIZER_ROUTE_RULE_ID,
  REQUEST_ROUTE_RULE_ID as FILE_ORGANIZER_REQUEST_ROUTE_RULE_ID,
  PLANNER_RULE_ID as FILE_ORGANIZER_PLANNER_RULE_ID,
};
