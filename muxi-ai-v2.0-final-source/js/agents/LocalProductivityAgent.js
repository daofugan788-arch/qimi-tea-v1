import { ExecutionPlanStatus } from "../agent/ExecutionPlan.js";
import {
  LocalProductivityOperation,
  LocalProductivityTool,
} from "../tools/LocalProductivityTool.js";

const INTERNAL_ROUTE_RULE_ID = "route-local-productivity-tool";
const CONTENT_ROUTE_RULE_ID = "route-content-assistant";
const CUSTOMER_ROUTE_RULE_ID = "route-customer-follow-up-assistant";
const CONTENT_PLANNER_RULE_ID = "plan-content-assistant";
const CUSTOMER_PLANNER_RULE_ID = "plan-customer-follow-up-assistant";

// Sprint 09 的轻量本地适配器：复用既有执行链路，不增加新的底层框架。
export class LocalProductivityAgent {
  constructor({ intentRouter, planner, taskQueue, executor, toolRegistry, tool } = {}) {
    if (!intentRouter || typeof intentRouter.registerRule !== "function") {
      throw new Error("LocalProductivityAgent 需要 IntentRouter");
    }
    if (!planner || typeof planner.registerRule !== "function" || typeof planner.createPlan !== "function") {
      throw new Error("LocalProductivityAgent 需要 AgentPlanner");
    }
    if (!taskQueue || typeof taskQueue.start !== "function") throw new Error("LocalProductivityAgent 需要 TaskQueue");
    if (!executor || typeof executor.getExecution !== "function") throw new Error("LocalProductivityAgent 需要 AgentExecutor");
    this.toolRegistry = toolRegistry || executor.toolRegistry;
    if (!this.toolRegistry || typeof this.toolRegistry.register !== "function") {
      throw new Error("LocalProductivityAgent 需要 ToolRegistry");
    }

    this.intentRouter = intentRouter;
    this.planner = planner;
    this.taskQueue = taskQueue;
    this.executor = executor;
    this.tool = tool || new LocalProductivityTool();
    this.registerTool();
    this.registerIntentRoutes();
    this.registerPlannerRules();
  }

  registerTool() {
    if (!this.toolRegistry.has(this.tool.name)) this.toolRegistry.register(this.tool);
    return this.toolRegistry.get(this.tool.name);
  }

  registerIntentRoutes() {
    const registeredRuleIds = new Set(this.intentRouter.getRules().map((rule) => rule.id));
    if (!registeredRuleIds.has(INTERNAL_ROUTE_RULE_ID)) {
      this.intentRouter.registerRule({
        id: INTERNAL_ROUTE_RULE_ID,
        intent: "local_productivity_step",
        toolName: this.tool.name,
        description: "将内容和客户记录步骤路由到本地生产力工具",
        priority: 300,
        patterns: [/^本地生产力步骤：(draft_product_intro|normalize_customer_records|classify_customer_records)$/i],
        extractParams: ({ match }) => ({ operation: match[1].toLowerCase() }),
      });
    }
    if (!registeredRuleIds.has(CONTENT_ROUTE_RULE_ID)) {
      this.intentRouter.registerRule({
        id: CONTENT_ROUTE_RULE_ID,
        intent: "content_assistant",
        toolName: this.tool.name,
        description: "识别产品介绍文案请求",
        priority: 260,
        patterns: [/(?:帮我|请)?(?:生成|写|撰写).*(?:产品介绍|产品简介).*(?:文案|文章)?/i],
        extractParams: () => ({
          operation: LocalProductivityOperation.DRAFT_PRODUCT_INTRO,
          productName: "暮曦 AI",
          highlights: [],
        }),
      });
    }
    if (!registeredRuleIds.has(CUSTOMER_ROUTE_RULE_ID)) {
      this.intentRouter.registerRule({
        id: CUSTOMER_ROUTE_RULE_ID,
        intent: "customer_follow_up_assistant",
        toolName: this.tool.name,
        description: "识别客户跟进记录整理请求",
        priority: 260,
        patterns: [/(?:帮我|请)?整理.*客户.*(?:跟进|回访).*(?:记录|资料)?/i],
        extractParams: () => ({
          operation: LocalProductivityOperation.CLASSIFY_CUSTOMER_RECORDS,
          records: [],
        }),
      });
    }
  }

  registerPlannerRules() {
    const registeredRuleIds = new Set(this.planner.getRules().map((rule) => rule.id));
    if (!registeredRuleIds.has(CONTENT_PLANNER_RULE_ID)) {
      this.planner.registerRule({
        id: CONTENT_PLANNER_RULE_ID,
        intent: "content_assistant",
        description: "使用本地模板生成可编辑的产品介绍草稿",
        priority: 260,
        patterns: [/(?:帮我|请)?(?:生成|写|撰写).*(?:产品介绍|产品简介).*(?:文案|文章)?/i],
        buildSteps: ({ metadata = {} }) => [{
          key: "draft",
          name: "生成产品介绍草稿",
          description: "根据产品名称和卖点生成确定性的本地模板草稿。",
          input: `本地生产力步骤：${LocalProductivityOperation.DRAFT_PRODUCT_INTRO}`,
          params: {
            operation: LocalProductivityOperation.DRAFT_PRODUCT_INTRO,
            productName: String(metadata.productName || "暮曦 AI"),
            highlights: Array.isArray(metadata.highlights) ? metadata.highlights : [],
          },
        }],
      });
    }
    if (!registeredRuleIds.has(CUSTOMER_PLANNER_RULE_ID)) {
      this.planner.registerRule({
        id: CUSTOMER_PLANNER_RULE_ID,
        intent: "customer_follow_up_assistant",
        description: "先规范化再分类用户主动提供的客户跟进记录",
        priority: 260,
        patterns: [/(?:帮我|请)?整理.*客户.*(?:跟进|回访).*(?:记录|资料)?/i],
        buildSteps: ({ metadata = {} }) => {
          const records = this.tool.normalizeRecords(metadata.records);
          return [
            {
              key: "normalize",
              name: "规范化客户跟进记录",
              description: "清理字段格式，不保存、不上传客户数据。",
              input: `本地生产力步骤：${LocalProductivityOperation.NORMALIZE_CUSTOMER_RECORDS}`,
              params: {
                operation: LocalProductivityOperation.NORMALIZE_CUSTOMER_RECORDS,
                records,
              },
            },
            {
              key: "classify",
              name: "分类客户跟进记录",
              description: "按待跟进、已成交、暂缓、未分类生成本地分类结果。",
              input: `本地生产力步骤：${LocalProductivityOperation.CLASSIFY_CUSTOMER_RECORDS}`,
              params: {
                operation: LocalProductivityOperation.CLASSIFY_CUSTOMER_RECORDS,
                records,
              },
              dependsOn: ["normalize"],
            },
          ];
        },
      });
    }
  }

  createContentPlan({
    request = "帮我生成一篇产品介绍文案",
    productName = "暮曦 AI",
    highlights = [],
  } = {}) {
    return this.planner.createPlan(request, {
      metadata: {
        agent: "content_assistant",
        productName,
        highlights: Array.isArray(highlights) ? highlights : [],
        localOnly: true,
      },
    });
  }

  createCustomerPlan({
    request = "帮我整理客户跟进记录",
    records = [],
  } = {}) {
    return this.planner.createPlan(request, {
      metadata: {
        agent: "customer_follow_up_assistant",
        records: this.tool.normalizeRecords(records),
        localOnly: true,
      },
    });
  }

  async runContent(options = {}) {
    const created = this.createContentPlan(options);
    const plan = await this.planner.executePlan(created.id);
    const result = plan.steps.find((step) => step.metadata?.sourceKey === "draft")?.result || null;
    return {
      agent: "content_assistant",
      plan,
      result,
      completed: plan.status === ExecutionPlanStatus.SUCCESS,
      remoteModelUsed: false,
    };
  }

  async runCustomer(options = {}) {
    const created = this.createCustomerPlan(options);
    const plan = await this.planner.executePlan(created.id);
    const result = plan.steps.find((step) => step.metadata?.sourceKey === "classify")?.result || null;
    return {
      agent: "customer_follow_up_assistant",
      plan,
      result,
      completed: plan.status === ExecutionPlanStatus.SUCCESS,
      remoteModelUsed: false,
    };
  }
}

export {
  INTERNAL_ROUTE_RULE_ID as LOCAL_PRODUCTIVITY_ROUTE_RULE_ID,
  CONTENT_ROUTE_RULE_ID,
  CUSTOMER_ROUTE_RULE_ID,
  CONTENT_PLANNER_RULE_ID,
  CUSTOMER_PLANNER_RULE_ID,
};
