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
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export class DailyMissionService {
  constructor({
    orchestrator,
    memoryService,
    eventBus,
    timeZone = "Asia/Shanghai",
    hour = 8,
    minute = 0,
    intervalMs = 60_000,
    retryDelayMs = 15 * 60_000,
    now = () => new Date(),
    goal = "找到今天最值得测试的3个小商品",
    searchGoal = "寻找前20个价格100以内、预计利润20以上的热门小商品",
    searchQueries = ["phone stand OR cable organizer OR mini desk fan"],
    constraints = { maxSourcePrice: 100, minProfit: 20, limit: 8 },
    shippingCost = 5,
    platformRate = 0.05,
    otherCost = 0,
    keepAlive = true,
  } = {}) {
    this.orchestrator = orchestrator;
    this.memoryService = memoryService;
    this.eventBus = eventBus;
    this.timeZone = timeZone;
    this.runMinute = hour * 60 + minute;
    this.intervalMs = intervalMs;
    this.retryDelayMs = retryDelayMs;
    this.now = now;
    this.goal = goal;
    this.searchGoal = searchGoal;
    this.searchQueries = searchQueries;
    this.constraints = constraints;
    this.shippingCost = shippingCost;
    this.platformRate = platformRate;
    this.otherCost = otherCost;
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
    await this.memoryService.write("commerce.employee", "heartbeat", {
      status: "ALIVE",
      timestamp: now.toISOString(),
      timeZone: this.timeZone,
      nextDailyTime: "08:00",
    });
    const state = await this.memoryService.read("commerce.daily-schedule", clock.date);
    if (!force && clock.minutes < this.runMinute) return { status: "WAITING", date: clock.date };
    if (!force && state?.status === "SUCCESS") return { status: "ALREADY_COMPLETED", date: clock.date, missionId: state.missionId };
    if (!force && state?.status === "RUNNING") return { status: "ALREADY_RUNNING", date: clock.date };
    if (!force && state?.lastAttemptAt && now.getTime() - new Date(state.lastAttemptAt).getTime() < this.retryDelayMs) {
      return { status: "RETRY_COOLDOWN", date: clock.date };
    }

    await this.memoryService.write("commerce.daily-schedule", clock.date, {
      status: "RUNNING",
      lastAttemptAt: now.toISOString(),
    });
    await this.eventBus.publish("commerce.daily.started", { date: clock.date, goal: this.goal }, { source: "plugin.commerce.daily" });
    try {
      const mission = await this.orchestrator.dispatch({
        type: "commerce.daily",
        goal: this.goal,
        priority: 100,
        input: {
          searchGoal: this.searchGoal,
          searchQueries: this.searchQueries,
          constraints: this.constraints,
          shippingCost: this.shippingCost,
          platformRate: this.platformRate,
          otherCost: this.otherCost,
          desiredCount: 3,
          dailyDate: clock.date,
        },
        metadata: { autonomous: true, source: "daily-08:00", timeZone: this.timeZone },
      });
      const report = mission.tasks.find((task) => task.input?.action === "report")?.output || null;
      const status = mission.status === "SUCCESS" ? "SUCCESS" : "FAILED";
      await this.memoryService.write("commerce.daily-schedule", clock.date, {
        status,
        missionId: mission.id,
        lastAttemptAt: now.toISOString(),
        completedAt: new Date().toISOString(),
        reportId: report?.missionId || mission.id,
        error: mission.error || null,
      });
      await this.eventBus.publish(`commerce.daily.${status.toLowerCase()}`, { date: clock.date, missionId: mission.id, report }, {
        source: "plugin.commerce.daily",
        missionId: mission.id,
      });
      return mission;
    } catch (error) {
      await this.memoryService.write("commerce.daily-schedule", clock.date, {
        status: "FAILED",
        lastAttemptAt: now.toISOString(),
        error: error?.message || "Daily Mission failed",
      });
      await this.eventBus.publish("commerce.daily.failed", { date: clock.date, error: error?.message || "Daily Mission failed" }, {
        source: "plugin.commerce.daily",
      });
      throw error;
    }
  }
}
