// 记录任务、步骤、结果、错误与时间，供自动化历史页面恢复查看。
export class ExecutionLogger {
  constructor(repository) {
    this.repository = repository;
  }

  startTask(task) {
    const now = new Date().toISOString();
    return this.repository.addHistory({
      id: task.id,
      input: task.input,
      intent: task.parsed.intent,
      intentLabel: task.parsed.label,
      riskLevel: task.riskLevel,
      requiresConfirmation: task.requiresConfirmation,
      status: task.status,
      createdAt: now,
      updatedAt: now,
      error: "",
      steps: task.actions.map((item) => ({
        id: item.id,
        type: item.type,
        params: item.params,
        riskLevel: item.riskLevel,
        requiresConfirmation: item.requiresConfirmation,
        status: item.status,
        result: null,
        error: item.validationErrors?.join("；") || "",
        startedAt: null,
        finishedAt: null,
      })),
    });
  }

  updateTask(taskId, status, error = "") {
    return this.repository.updateHistory(taskId, (record) => ({ ...record, status, error: String(error || "") }));
  }

  updateStep(taskId, action, { result = null, error = "", startedAt = null, finishedAt = null } = {}) {
    return this.repository.updateHistory(taskId, (record) => ({
      ...record,
      steps: record.steps.map((step) => step.id === action.id ? {
        ...step,
        status: action.status,
        result,
        error: String(error || ""),
        startedAt: startedAt || step.startedAt,
        finishedAt: finishedAt || step.finishedAt,
      } : step),
    }));
  }

  getHistory() {
    return this.repository.getHistory();
  }

  clear() {
    this.repository.clearHistory();
  }
}

