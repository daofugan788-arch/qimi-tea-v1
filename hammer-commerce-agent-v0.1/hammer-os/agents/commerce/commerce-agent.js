import { BaseAgent } from "../base-agent.js";

export class CommerceAgent extends BaseAgent {
  static agentType = "commerce";

  async onTask(task) {
    await this.emit("commerce.task.received", { input: task.input });
    const action = task.input?.action;
    if (action === "legacy-bridge") {
      return this.useTool("commerce.legacy.bridge", task.input?.payload || {});
    }
    if (action === "collect") return this.collect(task);
    if (action === "decide") return this.evaluate(task);
    if (action === "report") return this.report(task);
    if (action === "evening-report") return this.eveningReport(task);
    throw new Error(`Commerce Employee 不支持动作：${action || "未指定"}`);
  }

  dependency(task) {
    return Object.values(task.dependencyOutputs || {}).find((value) => value !== null) || null;
  }

  async collect(task) {
    const browserResult = this.dependency(task);
    if (!browserResult) throw new Error("Commerce Employee 没有收到 Browser Agent 结果");
    const result = await this.useTool("commerce.opportunity.collect", {
      browserResult,
      minimumProfit: task.mission?.input?.minimumProfit,
      shippingCost: task.mission?.input?.shippingCost,
      platformRate: task.mission?.input?.platformRate,
      otherCost: task.mission?.input?.otherCost,
      dailyDate: task.mission?.input?.dailyDate,
    });
    await this.emit("commerce.opportunities.collected", { count: result.opportunities.length, runId: result.runId });
    return result;
  }

  async evaluate(task) {
    const collection = this.dependency(task);
    if (!collection) throw new Error("Commerce Employee 没有收到 Data Tool 结果");
    const outcomes = (await this.memoryService.list("commerce.outcomes")).map((entry) => entry.value);
    const evaluated = [];
    for (const opportunity of collection.opportunities || []) {
      const judgment = await this.decide("commerce.opportunity.evaluate", { opportunity, outcomes });
      const record = {
        ...opportunity,
        score: judgment.score,
        risk: judgment.risk,
        decision: judgment.decision,
        reason: judgment.reason,
        learning: judgment.learning,
        decided_at: judgment.decidedAt,
      };
      await this.memoryService.write("commerce.opportunities", record.id, record);
      evaluated.push(record);
    }
    await this.emit("commerce.opportunities.decided", {
      scannedCount: collection.scannedCount,
      testCount: evaluated.filter((item) => item.decision === "TEST").length,
      watchCount: evaluated.filter((item) => item.decision === "WATCH").length,
      rejectCount: evaluated.filter((item) => item.decision === "REJECT").length,
    });
    return { ...collection, evaluated };
  }

  async report(task) {
    const evaluation = this.dependency(task);
    if (!evaluation) throw new Error("Commerce Employee 没有收到 Decision Service 结果");
    const report = await this.useTool("commerce.daily.report", {
      missionId: this.missionId,
      goal: task.mission?.goal,
      desiredCount: task.mission?.input?.desiredCount || 3,
      scannedCount: evaluation.scannedCount,
      evaluated: evaluation.evaluated,
      evidenceRunId: evaluation.runId,
      evidenceFile: evaluation.evidenceFile,
      browserVerifiedCount: evaluation.browserVerifiedCount,
      materials: evaluation.materials || [],
      missionSource: task.mission?.metadata?.source || "owner-command",
      dailyDate: task.mission?.input?.dailyDate,
      reportLimit: task.mission?.input?.reportLimit || 3,
    });
    await this.memoryService.write("commerce.daily-reports", report.date, report);
    await this.memoryService.write("commerce.employee", "latest-report", report);
    await this.emit("commerce.daily.report.generated", { report });
    return report;
  }

  async eveningReport(task) {
    const dailyDate = task.mission?.input?.dailyDate || new Date().toISOString().slice(0, 10);
    const opportunities = (await this.memoryService.list("commerce.opportunities"))
      .map((entry) => entry.value)
      .filter((item) => (item.daily_date || String(item.timestamp || "").slice(0, 10)) === dailyDate);
    const morningReport = await this.memoryService.read("commerce.daily-reports", dailyDate);
    const report = await this.useTool("commerce.daily.report", {
      missionId: this.missionId,
      goal: task.mission?.goal,
      dailyDate,
      reportLimit: task.mission?.input?.reportLimit || 3,
      scannedCount: morningReport?.scannedCount || opportunities.length,
      evaluated: opportunities,
      evidenceRunId: morningReport?.evidenceRunId || null,
      evidenceFile: morningReport?.evidenceFile || null,
      materials: morningReport?.publishingMaterials || [],
      missionSource: "evening-20:00",
    });
    await this.memoryService.write("commerce.daily-reports", dailyDate, report);
    await this.memoryService.write("commerce.employee", "latest-report", report);
    await this.emit("commerce.evening.report.generated", { report });
    return report;
  }
}
