import { TOOL_RISK, TOOL_TYPE } from "../../tools/tool-types.js";

export class CommerceLegacyBridgeTool {
  constructor(handler = async (input) => ({ accepted: true, mode: "architecture-freeze", input })) {
    this.name = "commerce.legacy.bridge";
    this.type = TOOL_TYPE.PLUGIN;
    this.riskLevel = TOOL_RISK.LOW;
    this.description = "Commerce Plugin 与冻结业务兼容层之间的唯一桥接工具";
    this.handler = handler;
  }

  execute(input, context) {
    return this.handler(input, context);
  }
}
