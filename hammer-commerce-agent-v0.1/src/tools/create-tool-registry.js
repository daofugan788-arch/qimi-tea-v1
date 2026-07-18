import { ToolRegistry } from "../core/tool-registry.js";
import { goalAnalyzeTool } from "./goal-analyze-tool.js";
import { scopeDefineTool } from "./scope-define-tool.js";
import { executionPlanTool } from "./execution-plan-tool.js";
import { reportComposeTool } from "./report-compose-tool.js";
import { productNormalizeTool } from "./product-normalize-tool.js";
import { ProfitCalculatorTool } from "./profit-calculator-tool.js";
import { productScoreTool } from "./product-score-tool.js";

export function createToolRegistry() {
  return new ToolRegistry()
    .register(goalAnalyzeTool)
    .register(scopeDefineTool)
    .register(executionPlanTool)
    .register(productNormalizeTool)
    .register(new ProfitCalculatorTool())
    .register(productScoreTool)
    .register(reportComposeTool);
}
