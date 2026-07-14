import { Tool, ToolRiskLevel } from "../Tool.js";

// Tool SDK 最小示例。只回显输入文本，不包含业务逻辑、网络请求或系统控制。
export class EchoTool extends Tool {
  constructor() {
    super({
      name: "echo",
      type: "sdk_example",
      description: "回显输入文本，用于验证 Tool SDK 执行链路",
      riskLevel: ToolRiskLevel.LOW,
      paramsSchema: {
        text: {
          type: "string",
          required: true,
          description: "需要回显的文本",
        },
      },
    });
    this.cancelledTaskIds = new Set();
  }

  validate(params) {
    return super.validate(params);
  }

  async execute(task, { params = {} } = {}) {
    if (this.cancelledTaskIds.delete(task.id)) {
      return { status: "cancelled", error: "示例工具执行已取消", taskId: task.id };
    }
    return {
      status: "success",
      taskId: task.id,
      text: params.text,
    };
  }

  async cancel({ taskId } = {}) {
    if (!taskId) return { cancelled: false, message: "缺少需要取消的 taskId" };
    this.cancelledTaskIds.add(taskId);
    return { cancelled: true, taskId };
  }
}

export const echoTool = new EchoTool();
