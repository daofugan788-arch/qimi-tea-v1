export class CheckpointStore {
  constructor(memoryService) {
    this.memory = memoryService;
    this.namespace = "runtime.checkpoints";
  }

  save(mission) {
    return this.memory.write(this.namespace, mission.id, mission);
  }

  load(missionId) {
    return this.memory.read(this.namespace, missionId);
  }

  list() {
    return this.memory.list(this.namespace);
  }
}
