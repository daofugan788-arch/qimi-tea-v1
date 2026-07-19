import { CommerceAgent } from "../../agents/commerce/commerce-agent.js";
import { ProductSearchAgent } from "../../agents/commerce/product-search-agent.js";
import { ContentAgent } from "../../agents/content/content-agent.js";
import { definePlugin } from "../plugin-contract.js";
import { CommerceLegacyBridgeTool } from "./commerce-bridge-tool.js";
import { ContentGenerationTool } from "./content-generation-tool.js";
import { DailyMissionService } from "./daily-mission-service.js";
import { OpportunityDataTool } from "./opportunity-data-tool.js";
import { evaluateOpportunity } from "./opportunity-decision-policy.js";
import { OpportunityReportTool } from "./opportunity-report-tool.js";
import { ProductSearchTool } from "./product-search-tool.js";

function employeePlan(mission) {
  const searchTaskId = `${mission.id}:search`;
  const collectTaskId = `${mission.id}:collect`;
  const decisionTaskId = `${mission.id}:decision`;
  const contentTaskId = `${mission.id}:content`;
  return [
    {
      id: searchTaskId,
      title: "商品搜索 Agent 收集公开商品信息",
      agentType: ProductSearchAgent.agentType,
      input: {},
      priority: mission.priority,
      maxRetries: 2,
      retryDelayMs: 0,
    },
    {
      id: collectTaskId,
      title: "Data Tool 收集商品机会",
      agentType: CommerceAgent.agentType,
      input: { action: "collect" },
      dependsOn: [searchTaskId],
      priority: mission.priority,
    },
    {
      id: decisionTaskId,
      title: "Decision Service 判断测试价值",
      agentType: CommerceAgent.agentType,
      input: { action: "decide" },
      dependsOn: [collectTaskId],
      priority: mission.priority,
    },
    {
      id: contentTaskId,
      title: "商品资料生成 Agent 输出可复制内容",
      agentType: ContentAgent.agentType,
      input: {},
      dependsOn: [decisionTaskId],
      priority: mission.priority,
    },
    {
      id: `${mission.id}:report`,
      title: "生成今日机会商品日报",
      agentType: CommerceAgent.agentType,
      input: { action: "report" },
      dependsOn: [contentTaskId],
      priority: mission.priority,
    },
  ];
}

export function createCommercePlugin({ bridgeHandler, dailyMission = {}, searchProviders = [], contentClient = null } = {}) {
  let memoryService = null;
  let dailyService = null;
  const compatibilityMode = typeof bridgeHandler === "function";
  const planners = compatibilityMode
    ? {
        commerce: (mission) => [{
          id: `${mission.id}:commerce:1`,
          title: "Commerce compatibility mission",
          agentType: CommerceAgent.agentType,
          input: { action: "legacy-bridge", payload: mission.input },
          priority: mission.priority,
          maxRetries: Number(mission.metadata?.maxRetries) || 0,
        }],
      }
    : { commerce: employeePlan, "commerce.daily": employeePlan };

  return definePlugin({
    manifest: {
      id: "commerce",
      name: "Hammer Commerce Employee Plugin",
      version: "0.7.0",
      capabilities: ["commerce.daily-mission", "commerce.opportunities", "commerce.learning", "commerce.daily-report"],
    },
    agents: compatibilityMode ? [CommerceAgent] : [ProductSearchAgent, CommerceAgent, ContentAgent],
    tools: [
      new CommerceLegacyBridgeTool(bridgeHandler),
      new ProductSearchTool(searchProviders),
      new OpportunityDataTool(),
      new ContentGenerationTool(contentClient),
      new OpportunityReportTool(),
    ],
    decisions: [{ id: "commerce.opportunity.evaluate", evaluate: evaluateOpportunity }],
    planners,
    subscriptions: [{
      type: "commerce.outcome.recorded",
      async handler(event) {
        if (!memoryService) return;
        const outcome = event.payload || {};
        if (!outcome.productName || !["SOLD", "NO_SALE", "RETURNED", "LOSS"].includes(outcome.outcome)) {
          throw new Error("Commerce 学习结果必须包含 productName 和有效 outcome");
        }
        const id = outcome.id || `OUT-${Date.now().toString(36).toUpperCase()}`;
        await memoryService.write("commerce.outcomes", id, {
          id,
          productName: String(outcome.productName),
          outcome: outcome.outcome,
          profit: Number(outcome.profit) || 0,
          note: String(outcome.note || ""),
          timestamp: outcome.timestamp || new Date().toISOString(),
        });
      },
    }],
    onInstall(services) {
      memoryService = services.memoryService;
      if (!compatibilityMode && dailyMission.enabled) {
        dailyService = new DailyMissionService({
          orchestrator: services.orchestrator,
          memoryService: services.memoryService,
          eventBus: services.eventBus,
          ...dailyMission,
        });
        void dailyService.start().catch((error) => services.eventBus.publish("commerce.daily.service.failed", {
          error: error?.message || "Daily Mission Service failed",
        }, { source: "plugin.commerce.daily" }));
      }
    },
  });
}

export { employeePlan };
