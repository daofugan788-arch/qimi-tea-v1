import { Tool, ToolRiskLevel } from "./Tool.js";

export const FileToolOperation = Object.freeze({
  SCAN_PREVIEW: "scan_preview",
  ORGANIZE_PREVIEW: "organize_preview",
  CONFIRM_PREVIEW: "confirm_preview",
});

const OPERATIONS = new Set(Object.values(FileToolOperation));

const CATEGORY_RULES = Object.freeze([
  { name: "图片", extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic"] },
  { name: "视频", extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"] },
  { name: "音频", extensions: ["mp3", "wav", "aac", "flac", "m4a", "ogg"] },
  { name: "文档", extensions: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv"] },
  { name: "压缩包", extensions: ["zip", "rar", "7z", "tar", "gz"] },
  { name: "安装包", extensions: ["apk", "xapk", "apks"] },
  { name: "代码", extensions: ["js", "mjs", "html", "css", "json", "java", "kt", "py", "sh"] },
]);

function safeName(value, index) {
  const basename = String(value || "")
    .replace(/\u0000/g, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1);
  return String(basename || `未命名文件-${index + 1}`).slice(0, 240);
}

function safeDirectory(value) {
  return String(value || "Download")
    .replace(/\u0000/g, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1) || "Download";
}

function extensionOf(name) {
  const index = name.lastIndexOf(".");
  return index > 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : "";
}

function categoryOf(name) {
  const extension = extensionOf(name);
  return CATEGORY_RULES.find((rule) => rule.extensions.includes(extension))?.name || "其他";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// File Tool V1 只处理用户提供的文件元数据并生成预览，不读取或修改真实文件。
export class FileTool extends Tool {
  constructor() {
    super({
      name: "file_tool",
      type: "local_file_preview",
      description: "根据用户提供的文件清单生成整理预览，当前版本不移动、不覆盖、不删除文件",
      riskLevel: ToolRiskLevel.LOW,
      paramsSchema: {
        operation: {
          type: "string",
          required: true,
          enum: Object.values(FileToolOperation),
          description: "预览操作类型",
        },
        directory: {
          type: "string",
          required: true,
          description: "仅用于显示的目录名称",
        },
        files: {
          type: "array",
          required: true,
          description: "由用户主动提供的文件元数据列表",
        },
      },
    });
  }

  normalizeFiles(files = []) {
    if (!Array.isArray(files)) return [];
    return files.map((file, index) => ({
      id: String(file?.id || `file-${index + 1}`),
      name: safeName(file?.name, index),
      size: Number.isFinite(Number(file?.size)) && Number(file.size) >= 0 ? Number(file.size) : 0,
      type: String(file?.type || ""),
      lastModified: Number.isFinite(Number(file?.lastModified)) ? Number(file.lastModified) : null,
    }));
  }

  validate(params) {
    const base = super.validate(params);
    const errors = [...base.errors];
    if (!OPERATIONS.has(params?.operation)) errors.push("不支持的文件预览操作");
    if (Array.isArray(params?.files) && params.files.length > 1000) errors.push("单次预览最多支持 1000 个文件");
    if (Array.isArray(params?.files)) {
      params.files.forEach((file, index) => {
        if (!file || typeof file !== "object" || Array.isArray(file)) errors.push(`第 ${index + 1} 个文件元数据无效`);
      });
    }
    return { valid: errors.length === 0, errors };
  }

  createOrganizationPreview(directory, files) {
    const groups = {};
    const proposedMoves = [];
    const duplicateNames = new Set();
    const seenNames = new Set();

    for (const file of files) {
      const category = categoryOf(file.name);
      if (!groups[category]) groups[category] = [];
      groups[category].push(clone(file));
      const loweredName = file.name.toLowerCase();
      if (seenNames.has(loweredName)) duplicateNames.add(file.name);
      seenNames.add(loweredName);
      proposedMoves.push({
        fileId: file.id,
        fileName: file.name,
        category,
        from: `${directory}/${file.name}`,
        to: `${directory}/${category}/${file.name}`,
        action: "preview_move",
        willExecute: false,
      });
    }

    return {
      directory,
      fileCount: files.length,
      totalBytes: files.reduce((total, file) => total + file.size, 0),
      groups,
      proposedMoves,
      warnings: duplicateNames.size
        ? [`发现同名文件：${[...duplicateNames].join("、")}，确认前不会覆盖。`]
        : [],
      executed: false,
    };
  }

  async execute(task, { params = {}, confirmed = false } = {}) {
    const operation = params.operation;
    const directory = safeDirectory(params.directory);
    const files = this.normalizeFiles(params.files);

    if (operation === FileToolOperation.SCAN_PREVIEW) {
      return {
        status: "success",
        operation,
        taskId: task.id,
        directory,
        files,
        fileCount: files.length,
        totalBytes: files.reduce((total, file) => total + file.size, 0),
        source: "user_provided_metadata",
        executed: false,
      };
    }

    const preview = this.createOrganizationPreview(directory, files);
    if (operation === FileToolOperation.ORGANIZE_PREVIEW) {
      return {
        status: "success",
        operation,
        taskId: task.id,
        ...preview,
      };
    }

    if (operation === FileToolOperation.CONFIRM_PREVIEW) {
      if (!confirmed) {
        return {
          status: "failed",
          operation,
          taskId: task.id,
          error: "文件整理预览需要用户手动确认",
          executed: false,
        };
      }
      return {
        status: "success",
        operation,
        taskId: task.id,
        confirmationRecorded: true,
        message: "已确认整理预览；当前版本不会移动、覆盖或删除任何文件。",
        ...preview,
        executed: false,
      };
    }

    return {
      status: "failed",
      operation,
      taskId: task.id,
      error: "不支持的文件预览操作",
      executed: false,
    };
  }

  async cancel({ taskId } = {}) {
    return {
      cancelled: Boolean(taskId),
      taskId: taskId || null,
      message: taskId ? "文件预览任务已取消" : "当前没有可取消的文件预览任务",
    };
  }
}

export const fileTool = new FileTool();
