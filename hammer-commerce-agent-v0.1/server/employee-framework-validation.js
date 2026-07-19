import { BaseEmployee, createHammerOS, definePlugin } from "../hammer-os/index.js";

class FinanceEmployee extends BaseEmployee {
  static employeeType = "finance";

  async onMessage(message) {
    if (message.type !== "REVIEW_REQUEST") return null;
    return this.reply(message, "REVIEW_COMPLETED", {
      approved: Number(message.payload.amount) > 0,
      reviewer: this.id,
    });
  }

  async execute(mission) {
    this.reportProgress(100, "finance-mission-completed");
    return { missionId: mission.id, ok: true };
  }
}

class ResearchEmployee extends BaseEmployee {
  static employeeType = "research";

  async execute(mission) {
    this.reportProgress(30, "research-ready");
    const review = await this.request(mission.input.financeId, "REVIEW_REQUEST", { amount: mission.input.amount });
    await this.context.knowledge.write("experience", "framework-validation", {
      research: this.id,
      finance: mission.input.financeId,
      communication: "MESSAGE_ONLY",
    }, { author: this.id });
    return review.payload;
  }
}

const teamPlugin = definePlugin({
  manifest: { id: "employee-framework-validation", version: "1.0.0" },
  employees: [ResearchEmployee, FinanceEmployee],
});
const hammer = createHammerOS({ plugins: [teamPlugin] });
const finance = await hammer.supervisor.hireByType("finance", { id: "finance-validation" });
const research = await hammer.supervisor.hireByType("research", { id: "research-validation" });
const completed = await hammer.supervisor.assign(research.id, {
  goal: "验证两个 Employee 通过 Message 协作",
  input: { financeId: finance.id, amount: 60 },
});

const output = {
  hammerStartedWithoutCommerce: !hammer.pluginManager.get("commerce"),
  installedEmployeePlugin: hammer.pluginManager.get("employee-framework-validation").manifest.id,
  employees: hammer.supervisor.list(),
  collaboration: completed.result,
  sharedKnowledge: await hammer.knowledgeCenter.read("experience", "framework-validation"),
  lifecycle: hammer.employeeRuntime.get(research.id).lifecycle.history,
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
await hammer.supervisor.retire(research.id);
await hammer.supervisor.retire(finance.id);
