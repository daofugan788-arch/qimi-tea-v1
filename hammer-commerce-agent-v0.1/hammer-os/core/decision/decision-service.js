export class DecisionService {
  constructor({ eventBus = null } = {}) {
    this.eventBus = eventBus;
    this.policies = new Map();
    this.unsubscribe = eventBus?.subscribe("decision.requested", async (event) => {
      const { policyId, input, context } = event.payload || {};
      try {
        const result = await this.evaluate(policyId, input, context);
        await eventBus.publish("decision.completed", { policyId, result }, {
          source: "core.decision-service",
          missionId: event.missionId,
          taskId: event.taskId,
          correlationId: event.correlationId,
        });
      } catch (error) {
        await eventBus.publish("decision.failed", { policyId, error: error?.message || "Decision failed" }, {
          source: "core.decision-service",
          missionId: event.missionId,
          taskId: event.taskId,
          correlationId: event.correlationId,
        });
      }
    }, { subscriberId: "core.decision-service" });
  }

  registerPolicy(id, handler, metadata = {}) {
    if (!id || typeof handler !== "function") throw new Error("Decision policy 配置无效");
    if (this.policies.has(id)) throw new Error(`Decision policy 已存在：${id}`);
    this.policies.set(id, { id, handler, metadata: { ...metadata } });
    return this;
  }

  async evaluate(id, input, context = {}) {
    const policy = this.policies.get(id);
    if (!policy) throw new Error(`Decision policy 未注册：${id}`);
    return policy.handler(input, { ...context, policy: policy.metadata });
  }

  listPolicies() {
    return [...this.policies.values()].map(({ handler, ...policy }) => policy);
  }
}
