export function definePlugin(plugin) {
  const id = String(plugin?.manifest?.id || "").trim();
  const version = String(plugin?.manifest?.version || "").trim();
  if (!id || !version) throw new Error("Plugin manifest 必须包含 id 和 version");
  return Object.freeze({
    manifest: Object.freeze({ ...plugin.manifest, id, version }),
    agents: Object.freeze([...(plugin.agents || [])]),
    tools: Object.freeze([...(plugin.tools || [])]),
    decisions: Object.freeze([...(plugin.decisions || [])]),
    planners: Object.freeze({ ...(plugin.planners || {}) }),
    subscriptions: Object.freeze([...(plugin.subscriptions || [])]),
    onInstall: plugin.onInstall || null,
  });
}
