export class PluginManager {
  constructor({ agentRegistry, toolRegistry, decisionService, plannerRegistry, eventBus, memoryService } = {}) {
    this.agentRegistry = agentRegistry;
    this.toolRegistry = toolRegistry;
    this.decisionService = decisionService;
    this.plannerRegistry = plannerRegistry;
    this.eventBus = eventBus;
    this.memoryService = memoryService;
    this.plugins = new Map();
    this.unsubscribers = new Map();
  }

  install(plugin) {
    const id = plugin?.manifest?.id;
    if (!id) throw new Error("Plugin manifest 无效");
    if (this.plugins.has(id)) throw new Error(`Plugin 已安装：${id}`);
    plugin.agents.forEach((AgentClass) => this.agentRegistry.register(AgentClass, { pluginId: id }));
    plugin.tools.forEach((tool) => this.toolRegistry.register(tool, { pluginId: id }));
    plugin.decisions.forEach((policy) => this.decisionService.registerPolicy(policy.id, policy.evaluate, { pluginId: id }));
    Object.entries(plugin.planners).forEach(([missionType, planner]) => this.plannerRegistry.register(missionType, planner, { pluginId: id }));
    const unsubscribers = plugin.subscriptions.map((subscription) => this.eventBus.subscribe(
      subscription.type,
      subscription.handler,
      { subscriberId: `plugin.${id}` },
    ));
    this.unsubscribers.set(id, unsubscribers);
    this.plugins.set(id, plugin);
    plugin.onInstall?.({
      eventBus: this.eventBus,
      memoryService: this.memoryService,
      toolRegistry: this.toolRegistry,
      decisionService: this.decisionService,
    });
    void this.eventBus.publish("plugin.installed", { plugin: plugin.manifest }, { source: "plugins.manager" });
    return plugin.manifest;
  }

  list() {
    return [...this.plugins.values()].map((plugin) => ({ ...plugin.manifest }));
  }

  get(id) {
    return this.plugins.get(id) || null;
  }
}
