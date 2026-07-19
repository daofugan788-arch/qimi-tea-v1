import { CheckpointStore } from "./checkpoint-store.js";
import { PriorityTaskQueue } from "./priority-task-queue.js";
import { RetryPolicy } from "./retry-policy.js";
import { createRuntimeTask } from "./runtime-entities.js";
import { MISSION_STATUS, TASK_STATUS } from "./runtime-status.js";
import { RuntimeWorker } from "./runtime-worker.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

export class HammerRuntime {
  constructor({ eventBus, agentRegistry, toolRegistry, memoryService, decisionService, scheduler, retryPolicy = new RetryPolicy() } = {}) {
    this.eventBus = eventBus;
    this.agentRegistry = agentRegistry;
    this.toolRegistry = toolRegistry;
    this.memoryService = memoryService;
    this.decisionService = decisionService;
    this.scheduler = scheduler;
    this.retryPolicy = retryPolicy;
    this.checkpoints = new CheckpointStore(memoryService);
    this.queue = new PriorityTaskQueue();
    this.missions = new Map();
    this.workers = new Map();
    this.unsubscribeMissionProjection = eventBus.subscribe("*", async (event) => {
      const mission = event.missionId ? this.missions.get(event.missionId) : null;
      if (!mission) return;
      mission.events ||= [];
      mission.events.push({
        id: event.id,
        type: event.type,
        source: event.source,
        taskId: event.taskId,
        timestamp: event.timestamp,
      });
      if (mission.events.length > 500) mission.events.shift();
      mission.updatedAt = new Date().toISOString();
    }, { subscriberId: "core.runtime.mission-projection" });
  }

  async startMission(mission, definitions) {
    if (!mission?.id) throw new Error("Runtime 缺少 Mission");
    const current = clone(mission);
    current.status = MISSION_STATUS.RUNNING;
    current.startedAt ||= new Date().toISOString();
    current.updatedAt = new Date().toISOString();
    current.tasks = definitions.map((definition, index) => createRuntimeTask(definition, current, index));
    this.missions.set(current.id, current);
    await this.eventBus.publish("runtime.mission.started", { mission: clone(current) }, {
      source: "core.runtime",
      missionId: current.id,
    });
    for (const task of current.tasks) {
      await this.eventBus.publish("runtime.task.created", { task: clone(task) }, {
        source: "core.runtime",
        missionId: current.id,
        taskId: task.id,
      });
    }
    await this.checkpoint(current);
    return this.run(current.id);
  }

  async run(missionId) {
    const mission = this.missions.get(missionId);
    if (!mission) throw new Error(`Runtime 找不到 Mission：${missionId}`);
    this.releaseDueTasks(mission);
    this.enqueueReadyTasks(mission);

    while (this.queue.size > 0) {
      const task = this.queue.dequeue();
      if (!task || task.missionId !== mission.id || task.status !== TASK_STATUS.QUEUED) continue;
      await this.executeTask(mission, task);
      this.releaseDueTasks(mission);
      this.skipBlockedDependents(mission);
      this.enqueueReadyTasks(mission);
    }

    const failed = mission.tasks.some((task) => task.status === TASK_STATUS.FAILED);
    const pending = mission.tasks.some((task) => [TASK_STATUS.WAITING, TASK_STATUS.SCHEDULED, TASK_STATUS.QUEUED, TASK_STATUS.RETRY].includes(task.status));
    mission.status = failed ? MISSION_STATUS.FAILED : pending ? MISSION_STATUS.WAITING : MISSION_STATUS.SUCCESS;
    mission.results = Object.fromEntries(mission.tasks.filter((task) => task.output !== null).map((task) => [task.id, task.output]));
    mission.error = failed ? mission.tasks.find((task) => task.status === TASK_STATUS.FAILED)?.error || "Mission failed" : null;
    mission.updatedAt = new Date().toISOString();
    if (!pending) mission.completedAt = mission.updatedAt;
    await this.checkpoint(mission);
    await this.eventBus.publish(`runtime.mission.${mission.status.toLowerCase()}`, { mission: clone(mission) }, {
      source: "core.runtime",
      missionId: mission.id,
    });
    return clone(mission);
  }

  async resumeMission(missionId) {
    let mission = this.missions.get(missionId);
    if (!mission) {
      mission = await this.checkpoints.load(missionId);
      if (!mission) throw new Error(`Checkpoint 不存在：${missionId}`);
      this.missions.set(missionId, mission);
    }
    mission.status = MISSION_STATUS.RUNNING;
    return this.run(missionId);
  }

  async cancelMission(missionId, reason = "Cancelled by orchestrator") {
    const mission = this.missions.get(missionId) || await this.checkpoints.load(missionId);
    if (!mission) throw new Error(`Runtime 找不到 Mission：${missionId}`);
    this.missions.set(missionId, mission);
    for (const task of mission.tasks) {
      if (![TASK_STATUS.SUCCESS, TASK_STATUS.FAILED, TASK_STATUS.SKIPPED, TASK_STATUS.CANCELLED].includes(task.status)) {
        this.queue.remove(task.id);
        this.scheduler.cancel(task.id);
        task.status = TASK_STATUS.CANCELLED;
        task.error = reason;
        task.completedAt = new Date().toISOString();
      }
    }
    mission.status = MISSION_STATUS.CANCELLED;
    mission.error = reason;
    mission.completedAt = new Date().toISOString();
    mission.updatedAt = mission.completedAt;
    await this.eventBus.publish("runtime.mission.cancelled", { missionId, reason }, {
      source: "core.runtime",
      missionId,
    });
    await this.checkpoint(mission);
    return clone(mission);
  }

  async executeTask(mission, task) {
    task.status = TASK_STATUS.RUNNING;
    task.attempts += 1;
    task.startedAt ||= new Date().toISOString();
    await this.eventBus.publish("runtime.task.running", { task: clone(task) }, {
      source: "core.runtime",
      missionId: mission.id,
      taskId: task.id,
    });
    const worker = new RuntimeWorker({
      agentRegistry: this.agentRegistry,
      eventBus: this.eventBus,
      toolRegistry: this.toolRegistry,
      memoryService: this.memoryService,
      decisionService: this.decisionService,
    });
    this.workers.set(worker.id, worker);
    try {
      task.output = await worker.execute(task, mission);
      task.status = TASK_STATUS.SUCCESS;
      task.completedAt = new Date().toISOString();
      task.error = null;
      await this.eventBus.publish("runtime.task.success", { task: clone(task), workerId: worker.id }, {
        source: "core.runtime",
        missionId: mission.id,
        taskId: task.id,
      });
    } catch (error) {
      task.error = error?.message || "Task failed";
      if (this.retryPolicy.shouldRetry(task)) {
        task.status = TASK_STATUS.RETRY;
        const runAt = this.retryPolicy.nextRunAt(task);
        if (task.retryDelayMs > 0) {
          task.status = TASK_STATUS.SCHEDULED;
          this.scheduler.schedule(task, runAt);
        } else {
          task.status = TASK_STATUS.QUEUED;
          this.queue.enqueue(task);
        }
        await this.eventBus.publish("runtime.task.retry", { task: clone(task), runAt }, {
          source: "core.runtime",
          missionId: mission.id,
          taskId: task.id,
        });
      } else {
        task.status = TASK_STATUS.FAILED;
        task.completedAt = new Date().toISOString();
        await this.eventBus.publish("runtime.task.failed", { task: clone(task), workerId: worker.id }, {
          source: "core.runtime",
          missionId: mission.id,
          taskId: task.id,
        });
      }
    }
    mission.updatedAt = new Date().toISOString();
    await this.checkpoint(mission);
  }

  enqueueReadyTasks(mission) {
    for (const task of mission.tasks) {
      if (task.status !== TASK_STATUS.WAITING) continue;
      if (task.runAt && new Date(task.runAt).getTime() > this.scheduler.now()) {
        task.status = TASK_STATUS.SCHEDULED;
        this.scheduler.schedule(task, task.runAt);
        continue;
      }
      const ready = task.dependsOn.every((id) => mission.tasks.find((item) => item.id === id)?.status === TASK_STATUS.SUCCESS);
      if (ready) {
        task.status = TASK_STATUS.QUEUED;
        this.queue.enqueue(task);
      }
    }
  }

  releaseDueTasks(mission) {
    for (const task of this.scheduler.due()) {
      if (task.missionId !== mission.id) continue;
      task.status = TASK_STATUS.QUEUED;
      this.queue.enqueue(task);
    }
  }

  skipBlockedDependents(mission) {
    const failedIds = new Set(mission.tasks.filter((task) => [TASK_STATUS.FAILED, TASK_STATUS.SKIPPED].includes(task.status)).map((task) => task.id));
    for (const task of mission.tasks) {
      if (task.status === TASK_STATUS.WAITING && task.dependsOn.some((id) => failedIds.has(id))) {
        task.status = TASK_STATUS.SKIPPED;
        task.error = "Dependency failed";
        task.completedAt = new Date().toISOString();
      }
    }
  }

  async checkpoint(mission) {
    await this.checkpoints.save(clone(mission));
  }

  getMission(id) {
    const mission = this.missions.get(id);
    return mission ? clone(mission) : null;
  }

  listWorkers() {
    return [...this.workers.values()].map(({ agentRegistry, eventBus, toolRegistry, memoryService, decisionService, ...worker }) => ({ ...worker }));
  }
}
