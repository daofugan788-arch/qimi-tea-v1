export const ToolRiskLevel = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
});

const RISK_LEVELS = new Set(Object.values(ToolRiskLevel));
const PARAMETER_TYPES = new Set(["string", "number", "boolean", "object", "array", "any"]);

export function cloneToolData(value) {
  if (value === undefined) return null;
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(value);
    } catch {
      // 不能结构化复制时回退到 JSON 数据。
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function normalizeToolRiskLevel(riskLevel) {
  const normalized = String(riskLevel || ToolRiskLevel.LOW).toUpperCase();
  if (!RISK_LEVELS.has(normalized)) throw new Error(`不支持的工具风险等级：${riskLevel}`);
  return normalized;
}

export function normalizeParamsSchema(paramsSchema = {}) {
  if (!paramsSchema || typeof paramsSchema !== "object" || Array.isArray(paramsSchema)) {
    throw new Error("工具 paramsSchema 必须是对象");
  }

  const normalized = {};
  for (const [name, definition] of Object.entries(paramsSchema)) {
    if (!name.trim()) throw new Error("工具参数名称不能为空");
    const source = typeof definition === "string" ? { type: definition } : definition;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error(`工具参数 ${name} 的定义无效`);
    }
    const type = String(source.type || "any").toLowerCase();
    if (!PARAMETER_TYPES.has(type)) throw new Error(`工具参数 ${name} 的类型 ${type} 不受支持`);
    const item = {
      type,
      required: Boolean(source.required),
      description: String(source.description || ""),
    };
    if (Array.isArray(source.enum)) item.enum = cloneToolData(source.enum);
    if (Object.prototype.hasOwnProperty.call(source, "default")) item.default = cloneToolData(source.default);
    normalized[name] = item;
  }
  return normalized;
}

function valueMatchesType(value, type) {
  if (type === "any") return true;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}

export function validateParamsWithSchema(paramsSchema, params = {}) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return { valid: false, errors: ["工具参数必须是对象"] };
  }

  const errors = [];
  for (const [parameterName, definition] of Object.entries(paramsSchema)) {
    const hasValue = Object.prototype.hasOwnProperty.call(params, parameterName);
    const value = params[parameterName];
    if (definition.required && (!hasValue || value === undefined || value === null || value === "")) {
      errors.push(`缺少必填参数：${parameterName}`);
      continue;
    }
    if (!hasValue || value === undefined || value === null) continue;
    if (!valueMatchesType(value, definition.type)) {
      errors.push(`参数 ${parameterName} 必须是 ${definition.type} 类型`);
      continue;
    }
    if (definition.enum && !definition.enum.includes(value)) {
      errors.push(`参数 ${parameterName} 必须是允许值之一`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// Tool SDK 基类。新工具通过继承此类获得统一字段和默认参数校验。
export class Tool {
  constructor({ name, type, description, riskLevel, paramsSchema } = {}) {
    this.name = String(name || "").trim();
    this.type = String(type || "").trim();
    this.description = String(description || "");
    this.riskLevel = normalizeToolRiskLevel(riskLevel);
    this.paramsSchema = normalizeParamsSchema(paramsSchema || {});
    if (!this.name) throw new Error("工具名称不能为空");
    if (!this.type) throw new Error("工具类型不能为空");
  }

  validate(params) {
    return validateParamsWithSchema(this.paramsSchema, params);
  }

  async execute() {
    throw new Error(`工具 ${this.name} 尚未实现 execute()`);
  }

  async cancel() {
    return { cancelled: false, message: `工具 ${this.name} 当前没有运行中的任务` };
  }
}

export function assertToolContract(tool) {
  if (!tool || typeof tool !== "object") throw new Error("Tool 必须是对象");
  if (!String(tool.name || "").trim()) throw new Error("Tool 缺少 name");
  if (!String(tool.type || "").trim()) throw new Error("Tool 缺少 type");
  if (typeof tool.description !== "string") throw new Error("Tool 缺少 description");
  normalizeToolRiskLevel(tool.riskLevel);
  normalizeParamsSchema(tool.paramsSchema);
  if (typeof tool.validate !== "function") throw new Error("Tool 缺少 validate()");
  if (typeof tool.execute !== "function") throw new Error("Tool 缺少 execute()");
  if (typeof tool.cancel !== "function") throw new Error("Tool 缺少 cancel()");
  return true;
}

// 兼容旧函数式注册，Registry 内部仍会把旧工具规范化为完整 Tool。
export function normalizeToolContract(definition = {}) {
  try {
    assertToolContract(definition);
    definition.riskLevel = normalizeToolRiskLevel(definition.riskLevel);
    definition.paramsSchema = normalizeParamsSchema(definition.paramsSchema);
    return definition;
  } catch (error) {
    if (typeof definition.execute !== "function") throw error;
  }

  const legacyValidate = typeof definition.validate === "function" ? definition.validate : null;
  const legacyExecute = definition.execute;
  const legacyCancel = typeof definition.cancel === "function" ? definition.cancel : null;

  class LegacyToolAdapter extends Tool {
    constructor() {
      super({
        name: definition.name,
        type: definition.type || "local",
        description: definition.description || "",
        riskLevel: definition.riskLevel || ToolRiskLevel.LOW,
        paramsSchema: definition.paramsSchema || definition.parameters || {},
      });
    }

    validate(params, context) {
      return legacyValidate ? legacyValidate.call(definition, params, context) : super.validate(params, context);
    }

    execute(task, context) {
      return legacyExecute.call(definition, task, context);
    }

    cancel(context) {
      return legacyCancel ? legacyCancel.call(definition, context) : super.cancel(context);
    }
  }

  return new LegacyToolAdapter();
}
