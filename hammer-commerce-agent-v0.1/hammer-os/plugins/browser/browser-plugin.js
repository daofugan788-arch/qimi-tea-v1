import { BrowserAgent } from "../../agents/browser/browser-agent.js";
import { definePlugin } from "../plugin-contract.js";
import { ProductPageVerificationTool } from "./product-page-verification-tool.js";

export function createBrowserPlugin({ verifier } = {}) {
  return definePlugin({
    manifest: {
      id: "browser",
      name: "Hammer Browser Verification Plugin",
      version: "0.8.0",
      capabilities: ["browser.product.verify", "browser.screenshot", "browser.public-page"],
    },
    agents: [BrowserAgent],
    tools: [new ProductPageVerificationTool(verifier)],
  });
}
