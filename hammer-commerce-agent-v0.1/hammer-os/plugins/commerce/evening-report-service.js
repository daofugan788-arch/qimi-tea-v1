function localClock(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export class EveningReportService {
  constructor({
    orchestrator,
    memoryService,
    eventBus,
    timeZone = "Asia/Shanghai",
    hour = 20,
    minute = 0,
    intervalMs = 60_000,
    now = () => new Date(),
    keepAlive = true,
  } = {}) {
    this.orchestrator = orchestrator;
    this.memoryService = memoryService;
    this.eventBus = eventBus;
    this.timeZone = timeZone;
    this.runMinute = hour * 60 + minute;
    this.intervalMs = intervalMs;
    this.now = now;
    this.keepAlive = keepAlive;
    this.timer = null;
    this.running = null;
  }

  async start() {
    if (this.timer) return this;
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    if (!this.keepAlive) this.timer.unref?.();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick({ force = false } = {}) {
    if (this.running) return this.running;
    this.running = this.executeTick(force).finally(() => { this.running = null; });
    return this.running;
  }

  async executeTick(force) {
    const now = this.now();
    const clock = localClock(now, this.timeZone);
    const state = await this.memoryService.read("commerce.evening-schedule", clock.date);
    if (!force && clock.minutes < this.runMinute) return { status: "WAITING", date: clock.date };
    if (!force && state?.status === "SUCCESS") return { status: "ALREADY_COMPLETED", date: clock.date, missionId: state.missionId };
    await this.memoryService.write("commerce.evening-schedule", clock.date, { status: "RUNNING", lastAttemptAt: now.toISOString() });
    const mission = await this.orchestrator.dispatch({
      type: "commerce.evening-report",
      goal: "生成今日商业机会报告",
      priority: 100,
      input: { dailyDate: clock.date, reportLimit: 3 },
      metadata: { autonomous: true, source: "evening-20:00", timeZone: this.timeZone },
    });
    const report = mission.tasks[0]?.output || null;
    await this.memoryService.write("commerce.evening-schedule", clock.date, {
      status: mission.status,
      missionId: mission.id,
      completedAt: new Date().toISOString(),
      reportId: report?.missionId || mission.id,
      error: mission.error || null,
    });
    await this.eventBus.publish(`commerce.evening.${mission.status.toLowerCase()}`, { date: clock.date, missionId: mission.id, report }, {
      source: "plugin.commerce.evening",
      missionId: mission.id,
    });
    return mission;
  }
}
