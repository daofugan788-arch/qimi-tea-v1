export class EventLogger {
  constructor(eventBus, { limit = 1000 } = {}) {
    this.limit = limit;
    this.entries = [];
    this.unsubscribe = eventBus.subscribe("*", async (event) => {
      this.entries.push({ ...event });
      if (this.entries.length > this.limit) this.entries.shift();
    }, { subscriberId: "core.event-logger" });
  }

  list({ missionId = null, type = null } = {}) {
    return this.entries.filter((entry) => (
      (!missionId || entry.missionId === missionId) && (!type || entry.type === type)
    ));
  }

  close() {
    this.unsubscribe?.();
  }
}
