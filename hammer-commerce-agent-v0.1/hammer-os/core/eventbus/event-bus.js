function eventId() {
  return `EVT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export class EventBus {
  constructor({ historyLimit = 500 } = {}) {
    this.historyLimit = historyLimit;
    this.subscribers = new Map();
    this.history = [];
  }

  subscribe(type, handler, { subscriberId = "anonymous" } = {}) {
    if (typeof handler !== "function") throw new Error("EventBus subscriber 必须是函数");
    const subscription = { id: `${subscriberId}:${eventId()}`, subscriberId, handler };
    const handlers = this.subscribers.get(type) || [];
    handlers.push(subscription);
    this.subscribers.set(type, handlers);
    return () => {
      const current = this.subscribers.get(type) || [];
      this.subscribers.set(type, current.filter((item) => item.id !== subscription.id));
    };
  }

  async publish(type, payload = {}, metadata = {}) {
    if (!type) throw new Error("EventBus event type 不能为空");
    const event = Object.freeze({
      id: eventId(),
      type,
      payload,
      source: metadata.source || "hammer-os",
      missionId: metadata.missionId || null,
      taskId: metadata.taskId || null,
      correlationId: metadata.correlationId || metadata.missionId || null,
      timestamp: new Date().toISOString(),
    });
    this.history.push(event);
    if (this.history.length > this.historyLimit) this.history.shift();
    const subscriptions = [
      ...(this.subscribers.get(type) || []),
      ...(this.subscribers.get("*") || []),
    ];
    const deliveries = await Promise.allSettled(
      subscriptions.map((subscription) => subscription.handler(event)),
    );
    return {
      event,
      deliveries: deliveries.map((delivery, index) => ({
        subscriberId: subscriptions[index].subscriberId,
        status: delivery.status,
        error: delivery.status === "rejected" ? String(delivery.reason?.message || delivery.reason) : null,
      })),
    };
  }

  recent(type = "*", limit = 50) {
    const events = type === "*" ? this.history : this.history.filter((event) => event.type === type);
    return events.slice(-Math.max(0, limit));
  }
}
