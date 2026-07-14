import { Tool, ToolRiskLevel } from "./Tool.js";

export const LocalProductivityOperation = Object.freeze({
  DRAFT_PRODUCT_INTRO: "draft_product_intro",
  NORMALIZE_CUSTOMER_RECORDS: "normalize_customer_records",
  CLASSIFY_CUSTOMER_RECORDS: "classify_customer_records",
});

const OPERATIONS = new Set(Object.values(LocalProductivityOperation));
const DEFAULT_HIGHLIGHTS = Object.freeze(["简单易用", "稳定可靠", "帮助用户高效完成日常任务"]);

function cleanText(value, fallback = "", maxLength = 500) {
  return String(value || fallback)
    .replace(/\u0000/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function inferFollowUpCategory(record) {
  const text = `${record.status} ${record.note} ${record.nextAction}`.toLowerCase();
  if (/(?:成交|签约|已购买|completed|closed[ -]?won)/i.test(text)) return "已成交";
  if (/(?:暂缓|拒绝|无意向|以后再说|closed[ -]?lost)/i.test(text)) return "暂缓";
  if (/(?:跟进|回访|联系|考虑|意向|报价|演示|试用|follow|pending)/i.test(text)) return "待跟进";
  return "未分类";
}

function inferPriority(record, category) {
  const text = `${record.note} ${record.nextAction}`.toLowerCase();
  if (/(?:紧急|尽快|马上|今天|urgent|asap)/i.test(text)) return "HIGH";
  if (category === "待跟进") return "MEDIUM";
  return "LOW";
}

// 仅执行确定性的本地模板和数据分类，不持久化、不联网，也不代表大模型生成结果。
export class LocalProductivityTool extends Tool {
  constructor() {
    super({
      name: "local_productivity_tool",
      type: "local_productivity",
      description: "使用本地规则生成产品介绍草稿并分类用户提供的客户跟进记录",
      riskLevel: ToolRiskLevel.LOW,
      paramsSchema: {
        operation: {
          type: "string",
          required: true,
          enum: Object.values(LocalProductivityOperation),
          description: "本地生产力操作类型",
        },
        productName: {
          type: "string",
          required: false,
          description: "需要介绍的产品名称",
        },
        highlights: {
          type: "array",
          required: false,
          description: "产品卖点列表",
        },
        records: {
          type: "array",
          required: false,
          description: "由用户主动提供的客户跟进记录",
        },
      },
    });
  }

  validate(params) {
    const base = super.validate(params);
    const errors = [...base.errors];
    if (!OPERATIONS.has(params?.operation)) errors.push("不支持的本地生产力操作");
    if (Array.isArray(params?.highlights) && params.highlights.length > 12) {
      errors.push("产品卖点最多支持 12 项");
    }
    if (Array.isArray(params?.records) && params.records.length > 500) {
      errors.push("单次最多整理 500 条客户跟进记录");
    }
    if (Array.isArray(params?.records)) {
      params.records.forEach((record, index) => {
        if (!record || typeof record !== "object" || Array.isArray(record)) {
          errors.push(`第 ${index + 1} 条客户记录无效`);
        }
      });
    }
    return { valid: errors.length === 0, errors };
  }

  normalizeRecords(records = []) {
    if (!Array.isArray(records)) return [];
    return records.map((record, index) => ({
      id: cleanText(record?.id, `customer-${index + 1}`, 100),
      customer: cleanText(record?.customer || record?.name, `客户 ${index + 1}`, 100),
      note: cleanText(record?.note || record?.content, "", 1000),
      status: cleanText(record?.status, "", 100),
      nextAction: cleanText(record?.nextAction, "", 300),
      lastContactAt: cleanText(record?.lastContactAt, "", 100) || null,
    }));
  }

  draftProductIntro(params) {
    const productName = cleanText(params.productName, "本产品", 100) || "本产品";
    const highlights = (Array.isArray(params.highlights) ? params.highlights : [])
      .map((item) => cleanText(item, "", 80))
      .filter(Boolean)
      .slice(0, 12);
    const normalizedHighlights = highlights.length ? highlights : [...DEFAULT_HIGHLIGHTS];
    const featureText = normalizedHighlights.map((item, index) => `${index + 1}. ${item}`).join("\n");
    return {
      title: `${productName}｜让日常任务更简单`,
      content: `${productName}，专为希望更轻松完成日常任务的用户打造。它以清晰、易用的方式，把复杂步骤整理成可理解、可确认的行动方案。\n\n核心亮点：\n${featureText}\n\n现在就从一个具体需求开始，让 ${productName} 帮你把事情一步步完成。`,
      highlights: normalizedHighlights,
      templateBased: true,
      processedLocally: true,
      remoteModelUsed: false,
    };
  }

  classifyRecords(records) {
    const normalizedRecords = this.normalizeRecords(records);
    const categories = {
      "待跟进": [],
      "已成交": [],
      "暂缓": [],
      "未分类": [],
    };
    for (const record of normalizedRecords) {
      const category = inferFollowUpCategory(record);
      categories[category].push({
        ...clone(record),
        category,
        priority: inferPriority(record, category),
      });
    }
    return {
      records: normalizedRecords,
      categories,
      summary: Object.fromEntries(
        Object.entries(categories).map(([category, items]) => [category, items.length]),
      ),
      total: normalizedRecords.length,
      processedLocally: true,
      persisted: false,
      remoteModelUsed: false,
    };
  }

  async execute(task, { params = {} } = {}) {
    if (params.operation === LocalProductivityOperation.DRAFT_PRODUCT_INTRO) {
      return {
        status: "success",
        operation: params.operation,
        taskId: task.id,
        ...this.draftProductIntro(params),
      };
    }

    if (params.operation === LocalProductivityOperation.NORMALIZE_CUSTOMER_RECORDS) {
      const records = this.normalizeRecords(params.records);
      return {
        status: "success",
        operation: params.operation,
        taskId: task.id,
        records,
        total: records.length,
        processedLocally: true,
        persisted: false,
        remoteModelUsed: false,
      };
    }

    if (params.operation === LocalProductivityOperation.CLASSIFY_CUSTOMER_RECORDS) {
      return {
        status: "success",
        operation: params.operation,
        taskId: task.id,
        ...this.classifyRecords(params.records),
      };
    }

    return {
      status: "failed",
      operation: params.operation || null,
      taskId: task.id,
      error: "不支持的本地生产力操作",
    };
  }

  async cancel({ taskId } = {}) {
    return {
      cancelled: Boolean(taskId),
      taskId: taskId || null,
      message: taskId ? "本地生产力任务已取消" : "当前没有可取消的本地生产力任务",
    };
  }
}

export const localProductivityTool = new LocalProductivityTool();
