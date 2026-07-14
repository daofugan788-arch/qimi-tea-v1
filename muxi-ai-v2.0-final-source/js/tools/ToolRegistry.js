import {
  ToolRiskLevel,
  cloneToolData,
  normalizeToolContract,
  normalizeToolRiskLevel,
} from "./Tool.js";

export { ToolRiskLevel } from "./Tool.js";

export const ToolPermissionCode = Object.freeze({
  ALLOWED: "ALLOWED",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_DISABLED: "TOOL_DISABLED",
  CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
  HIGH_RISK_BLOCKED: "HIGH_RISK_BLOCKED",
  INVALID_PARAMETERS: "INVALID_PARAMETERS",
});

function publicMetadata(record) {
  return cloneToolData({
    name: record.tool.name,
    type: record.tool.type,
    description: record.tool.description,
    paramsSchema: record.tool.paramsSchema,
    // parameters 保留为 Sprint 04 兼容别名。
    parameters: record.tool.paramsSchema,
    enabled: record.enabled,
    riskLevel: record.tool.riskLevel,
  });
}

function normalizeValidation(result) {
  if (result && typeof result.then === "function") {
    return { valid: false, errors: ["Tool.validate() 必须同步返回校验结果"] };
  }
  if (typeof result === "boolean") return { valid: result, errors: result ? [] : ["工具参数校验失败"] };
  if (!result || typeof result !== "object") return { valid: false, errors: ["Tool.validate() 返回值无效"] };
  const errors = Array.isArray(result.errors) ? result.errors.map((item) => String(item)) : [];
  return { valid: Boolean(result.valid) && errors.length === 0, errors };
}

export class ToolPermissionError extends Error {
  constructor(permission) {
    super(permission.message);
    this.name = "ToolPermissionError";
    this.code = permission.code;
    this.permission = cloneToolData(permission);
  }
}

// 本地工具注册中心。只管理 Tool SDK 工具和权限，不包含具体业务工具。
export class ToolRegistry {
  constructor() {
    this.records = new Map();
  }

  register(definition = {}) {
    const tool = normalizeToolContract(definition);
    this.records.set(tool.name, {
      tool,
      enabled: definition.enabled === undefined ? true : Boolean(definition.enabled),
    });
    return this.get(tool.name);
  }

  unregister(name) {
    return this.records.delete(String(name || "").trim());
  }

  has(name) {
    return this.records.has(String(name || "").trim());
  }

  get(name) {
    const record = this.records.get(String(name || "").trim());
    return record ? publicMetadata(record) : null;
  }

  list() {
    return [...this.records.values()].map((record) => publicMetadata(record));
  }

  setEnabled(name, enabled) {
    const record = this.requireRecord(name);
    record.enabled = Boolean(enabled);
    return publicMetadata(record);
  }

  setRiskLevel(name, riskLevel) {
    const record = this.requireRecord(name);
    record.tool.riskLevel = normalizeToolRiskLevel(riskLevel);
    return publicMetadata(record);
  }

  requireRecord(name) {
    const normalizedName = String(name || "").trim();
    const record = this.records.get(normalizedName);
    if (!record) throw new Error(`工具 ${normalizedName} 未注册`);
    return record;
  }

  validateParameters(name, params = {}, context = {}) {
    const record = this.requireRecord(name);
    try {
      return normalizeValidation(record.tool.validate(params, context));
    } catch (error) {
      return { valid: false, errors: [error?.message || "工具参数校验失败"] };
    }
  }

  checkPermission(name, { confirmed = false, params = {}, context = {} } = {}) {
    const normalizedName = String(name || "").trim();
    const record = this.records.get(normalizedName);
    if (!record) {
      return {
        allowed: false,
        code: ToolPermissionCode.TOOL_NOT_FOUND,
        message: `未找到任务类型 ${normalizedName} 对应的工具`,
        riskLevel: null,
      };
    }
    if (!record.enabled) {
      return {
        allowed: false,
        code: ToolPermissionCode.TOOL_DISABLED,
        message: `工具 ${normalizedName} 已禁用`,
        riskLevel: record.tool.riskLevel,
      };
    }
    if (record.tool.riskLevel === ToolRiskLevel.HIGH) {
      return {
        allowed: false,
        code: ToolPermissionCode.HIGH_RISK_BLOCKED,
        message: `工具 ${normalizedName} 属于 HIGH 风险，当前版本禁止执行`,
        riskLevel: record.tool.riskLevel,
      };
    }
    if (record.tool.riskLevel === ToolRiskLevel.MEDIUM && !confirmed) {
      return {
        allowed: false,
        code: ToolPermissionCode.CONFIRMATION_REQUIRED,
        message: `工具 ${normalizedName} 属于 MEDIUM 风险，需要用户确认`,
        riskLevel: record.tool.riskLevel,
      };
    }

    const validation = this.validateParameters(normalizedName, params, context);
    if (!validation.valid) {
      return {
        allowed: false,
        code: ToolPermissionCode.INVALID_PARAMETERS,
        message: validation.errors.join("；"),
        riskLevel: record.tool.riskLevel,
        errors: validation.errors,
      };
    }
    return {
      allowed: true,
      code: ToolPermissionCode.ALLOWED,
      message: "工具权限检查通过",
      riskLevel: record.tool.riskLevel,
    };
  }

  async execute(name, task, context = {}) {
    const normalizedContext = context && typeof context === "object" ? context : {};
    const permission = this.checkPermission(name, {
      confirmed: Boolean(normalizedContext.confirmed),
      params: normalizedContext.params || {},
      context: normalizedContext,
    });
    if (!permission.allowed) throw new ToolPermissionError(permission);
    return this.requireRecord(name).tool.execute(task, normalizedContext);
  }

  async cancel(name, context = {}) {
    return this.requireRecord(name).tool.cancel(context && typeof context === "object" ? context : {});
  }
}
