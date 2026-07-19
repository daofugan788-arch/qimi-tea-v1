export class PlannerRegistry {
  constructor() {
    this.planners = new Map();
  }

  register(missionType, planner, { pluginId = "core" } = {}) {
    if (!missionType || typeof planner !== "function") throw new Error("Mission Planner 配置无效");
    if (this.planners.has(missionType)) throw new Error(`Mission Planner 已存在：${missionType}`);
    this.planners.set(missionType, { planner, pluginId });
    return this;
  }

  async plan(mission) {
    const entry = this.planners.get(mission.type);
    if (!entry) throw new Error(`没有可处理 ${mission.type} Mission 的 Plugin Planner`);
    const tasks = await entry.planner(mission);
    if (!Array.isArray(tasks) || tasks.length === 0) throw new Error("Mission Planner 必须返回至少一个 Task");
    return tasks;
  }

  list() {
    return [...this.planners.entries()].map(([missionType, entry]) => ({ missionType, pluginId: entry.pluginId }));
  }
}
