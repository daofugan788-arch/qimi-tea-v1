import { CommerceAgent } from "../../agents/commerce/commerce-agent.js";
import { definePlugin } from "../plugin-contract.js";
import { CommerceLegacyBridgeTool } from "./commerce-bridge-tool.js";

export function createCommercePlugin({ bridgeHandler } = {}) {
  return definePlugin({
    manifest: {
      id: "commerce",
      name: "Hammer Commerce Plugin",
      version: "1.0.0-architecture-freeze",
      capabilities: ["commerce.mission.bridge"],
    },
    agents: [CommerceAgent],
    tools: [new CommerceLegacyBridgeTool(bridgeHandler)],
    planners: {
      commerce: (mission) => [{
        id: `${mission.id}:commerce:1`,
        title: "Commerce Plugin Mission",
        agentType: CommerceAgent.agentType,
        input: mission.input,
        priority: mission.priority,
        maxRetries: Number(mission.metadata?.maxRetries) || 0,
      }],
    },
  });
}
