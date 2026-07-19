import { createMission } from "../runtime/runtime-entities.js";

export class Orchestrator {
  constructor({ runtime, planner, eventBus } = {}) {
    this.runtime = runtime;
    this.planner = planner;
    this.eventBus = eventBus;
  }

  createMission(input) {
    const mission = createMission(input);
    if (!mission.type) throw new Error("Mission type 不能为空");
    if (!mission.goal) throw new Error("Mission goal 不能为空");
    return mission;
  }

  async dispatch(input) {
    const mission = this.createMission(input);
    await this.eventBus.publish("orchestrator.mission.created", { mission }, {
      source: "core.orchestrator",
      missionId: mission.id,
    });
    const tasks = await this.planner.plan(mission);
    await this.eventBus.publish("orchestrator.mission.planned", { missionId: mission.id, taskCount: tasks.length }, {
      source: "core.orchestrator",
      missionId: mission.id,
    });
    return this.runtime.startMission(mission, tasks);
  }

  resume(missionId) {
    return this.runtime.resumeMission(missionId);
  }

  cancel(missionId, reason) {
    return this.runtime.cancelMission(missionId, reason);
  }
}
