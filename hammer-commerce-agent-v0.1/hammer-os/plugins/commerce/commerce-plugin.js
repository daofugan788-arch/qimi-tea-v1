import { CommerceAgent } from "../../agents/commerce/commerce-agent.js";
import { ProductSearchAgent } from "../../agents/commerce/product-search-agent.js";
import { ContentAgent } from "../../agents/content/content-agent.js";
import { BrowserAgent } from "../../agents/browser/browser-agent.js";
import { definePlugin } from "../plugin-contract.js";
import { CommerceLegacyBridgeTool } from "./commerce-bridge-tool.js";
import { ContentGenerationTool } from "./content-generation-tool.js";
import { DailyMissionService } from "./daily-mission-service.js";
import { EveningReportService } from "./evening-report-service.js";
import { OpportunityDataTool } from "./opportunity-data-tool.js";
import { evaluateOpportunity } from "./opportunity-decision-policy.js";
import { OpportunityReportTool } from "./opportunity-report-tool.js";
import { ProductSearchTool } from "./product-search-tool.js";

function employeePlan(mission, { browserVerification = false } = {}) {
  const searchTaskId = `${mission.id}:search`;
  const browserTaskId = `${mission.id}:browser-verify`;
  const collectTaskId = `${mission.id}:collect`;
  const decisionTaskId = `${mission.id}:decision`;
  const contentTaskId = `${mission.id}:content`;
  const tasks = [
    {
      id: searchTaskId,
      title: "商品搜索 Agent 收集公开商品信息",
      agentType: ProductSearchAgent.agentType,
      input: {},
      priority: mission.priority,
      maxRetries: 2,
      retryDelayMs: 0,
    },
  ];
  if (browserVerification) {
    tasks.push({
      id: browserTaskId,
      title: "Browser Agent 真实打开商品页并保存截图",
      agentType: BrowserAgent.agentType,
      input: {
        toolName: "browser.product.verify",
        toolInput: { maxItems: mission.input?.browserVerifyLimit || 12 },
      },
      dependsOn: [searchTaskId],
      priority: mission.priority,
      maxRetries: 1,
    });
  }
  tasks.push(
    {
      id: collectTaskId,
      title: "Data Tool 收集商品机会",
      agentType: CommerceAgent.agentType,
      input: { action: "collect" },
      dependsOn: [browserVerification ? browserTaskId : searchTaskId],
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
  );
  return tasks;
}

function eveningPlan(mission) {
  return [{
    id: `${mission.id}:evening-report`,
    title: "汇总今日机会库并生成晚间商业报告",
    agentType: CommerceAgent.agentType,
    input: { action: "evening-report" },
    priority: mission.priority,
  }];
}

function productTokens(value) {
  return new Set(String(value || "").toLowerCase().match(/[\p{Script=Han}]{2,}|[a-z0-9]+/gu) || []);
}

function similarProduct(left, right) {
  const a = productTokens(left);
  const b = productTokens(right);
  if (!a.size || !b.size) return false;
  if ([...a].some((token) => b.has(token))) return true;
  const leftText = String(left || "").toLowerCase();
  const rightText = String(right || "").toLowerCase();
  return leftText.includes(rightText) || rightText.includes(leftText);
}

export function createCommercePlugin({ bridgeHandler, dailyMission = {}, searchProviders = [], contentClient = null, browserVerification = false } = {}) {
  let memoryService = null;
  let dailyService = null;
  let eveningService = null;
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
    : {
        commerce: (mission) => employeePlan(mission, { browserVerification }),
        "commerce.daily": (mission) => employeePlan(mission, { browserVerification }),
        "commerce.evening-report": eveningPlan,
      };

  return definePlugin({
    manifest: {
      id: "commerce",
      name: "Hammer Commerce Employee Plugin",
      version: "0.8.0",
      capabilities: ["commerce.daily-mission", "commerce.opportunities", "commerce.learning", "commerce.daily-report", "commerce.browser-verification"],
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
        const orders = Math.max(0, Number(outcome.orders) || 0);
        const profit = Number(outcome.profit) || 0;
        const normalizedOutcome = outcome.outcome || (orders > 0 || profit > 0 ? "SOLD" : "NO_SALE");
        if (!outcome.productName || !["SOLD", "NO_SALE", "RETURNED", "LOSS"].includes(normalizedOutcome)) {
          throw new Error("Commerce 学习结果必须包含 productName，并提供有效结果或成交数据");
        }
        const id = outcome.id || `OUT-${Date.now().toString(36).toUpperCase()}`;
        await memoryService.write("commerce.outcomes", id, {
          id,
          productName: String(outcome.productName),
          outcome: normalizedOutcome,
          orders,
          profit,
          note: String(outcome.note || ""),
          timestamp: outcome.timestamp || new Date().toISOString(),
        });
        const feedback = await memoryService.read("commerce.outcomes", id);
        for (const entry of await memoryService.list("commerce.opportunities")) {
          const opportunity = entry.value;
          if (!similarProduct(opportunity.name, outcome.productName) && !similarProduct(opportunity.product_type, outcome.productName)) continue;
          const history = [...(opportunity.history_results || []), feedback].slice(-30);
          const success = normalizedOutcome === "SOLD" && profit > 0;
          const experience = opportunity.experience || {};
          await memoryService.write("commerce.opportunities", entry.key, {
            ...opportunity,
            history_results: history,
            experience: {
              attempts: Number(experience.attempts || 0) + 1,
              totalOrders: Number(experience.totalOrders || 0) + orders,
              totalProfit: Number(experience.totalProfit || 0) + profit,
              successCount: Number(experience.successCount || 0) + (success ? 1 : 0),
              failureCount: Number(experience.failureCount || 0) + (success ? 0 : 1),
              lastResultAt: feedback.timestamp,
            },
          });
        }
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
        eveningService = new EveningReportService({
          orchestrator: services.orchestrator,
          memoryService: services.memoryService,
          eventBus: services.eventBus,
          ...dailyMission,
          hour: Number(dailyMission.eveningHour ?? 20),
          minute: Number(dailyMission.eveningMinute ?? 0),
        });
        void eveningService.start().catch((error) => services.eventBus.publish("commerce.evening.service.failed", {
          error: error?.message || "Evening Report Service failed",
        }, { source: "plugin.commerce.evening" }));
      }
    },
  });
}

export { employeePlan, eveningPlan };
