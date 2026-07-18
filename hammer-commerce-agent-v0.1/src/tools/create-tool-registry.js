import { ToolRegistry } from "../core/tool-registry.js";
import { goalAnalyzeTool } from "./goal-analyze-tool.js";
import { scopeDefineTool } from "./scope-define-tool.js";
import { executionPlanTool } from "./execution-plan-tool.js";
import { reportComposeTool } from "./report-compose-tool.js";
import { productNormalizeTool } from "./product-normalize-tool.js";
import { ProfitCalculatorTool } from "./profit-calculator-tool.js";
import { productScoreTool } from "./product-score-tool.js";
import { selectionPrepareTool } from "./selection-prepare-tool.js";
import { productCompareTool } from "./product-compare-tool.js";
import { createChainTools } from "./chain-tools.js";
import { productQuickCaptureTool } from "./product-quick-capture-tool.js";
import { createBrowserTools } from "./browser-tools.js";

export function createToolRegistry(dependencies = {}) {
  const registry = new ToolRegistry()
    .register(goalAnalyzeTool)
    .register(scopeDefineTool)
    .register(executionPlanTool)
    .register(productNormalizeTool)
    .register(productQuickCaptureTool)
    .register(new ProfitCalculatorTool())
    .register(productScoreTool)
    .register(selectionPrepareTool)
    .register(productCompareTool)
    .register(reportComposeTool);
  createChainTools(dependencies).forEach((tool) => registry.register(tool));
  createBrowserTools(dependencies).forEach((tool) => registry.register(tool));
  return registry;
}
