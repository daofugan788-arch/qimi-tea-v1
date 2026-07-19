import { TOOL_RISK } from "../../tools/tool-types.js";

const normalize = (value) => String(value || "").trim();

export class EmployeeToolGateway {
  constructor({ employeeId, employeeType, toolRegistry, approvalService, allowedTools = [] } = {}) {
    if (!employeeId || !toolRegistry || !approvalService) throw new Error("Employee Tool Gateway 依赖不完整");
    this.employeeId = employeeId;
    this.employeeType = employeeType || "employee";
    this.toolRegistry = toolRegistry;
    this.approvalService = approvalService;
    this.allowedTools = Object.freeze([...new Set((allowedTools || []).map(normalize).filter(Boolean))]);
  }

  describe(name) {
    return this.toolRegistry.describe(name);
  }

  isAllowed(name) {
    const metadata = this.describe(name);
    if (!metadata) return false;
    return this.allowedTools.includes("*")
      || this.allowedTools.includes(name)
      || this.allowedTools.some((permission) => permission.toUpperCase() === `TYPE:${metadata.type}`);
  }

  requiresApproval(name) {
    return this.describe(name)?.riskLevel === TOOL_RISK.HIGH;
  }

  listAllowed() {
    return this.toolRegistry.list().filter((tool) => this.isAllowed(tool.name));
  }

  async execute(name, input = {}, context = {}) {
    const metadata = this.describe(name);
    if (!metadata) throw new Error(`Employee Tool 未注册：${name}`);
    if (!this.isAllowed(name)) {
      const error = new Error(`Employee ${this.employeeId} 未授权使用 Tool：${name}`);
      error.code = "EMPLOYEE_TOOL_NOT_ALLOWED";
      throw error;
    }
    const toolContext = {
      ...context,
      employeeId: this.employeeId,
      employeeType: this.employeeType,
    };
    if (metadata.riskLevel === TOOL_RISK.HIGH) {
      await this.approvalService.request({
        employeeId: this.employeeId,
        employeeType: this.employeeType,
        missionId: context.missionId || null,
        tool: name,
        input,
        riskLevel: metadata.riskLevel,
      });
    }
    return this.toolRegistry.execute(name, input, toolContext);
  }
}
