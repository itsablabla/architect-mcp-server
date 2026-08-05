/**
 * MCP gateway metadata, isolated here so both the server entrypoint
 * (src/index.ts) and the dashboard (src/dashboard/dashboard.ts) can import it
 * without forming a circular dependency.
 */
export const GATEWAY_DESCRIPTIONS: Record<string, string> = {
    tool: "Build and manage custom tools: create, update, validate, approve capabilities, activate, test, version, templates, import/export. After create/save, invoke tools via run {action:\"call_tool\"} (or find to discover names).",
    find: "Discover existing tools before building: list, full-text search, view source, dependency graph, intent matching.",
    run: "Execute custom tools and compose workflows: call_tool (single), batch_execute, aliases, multi-step pipelines.",
    automate: "Run tools in the background through HTTP webhooks.",
    store: "Persistent data: encrypted secrets, namespaced key-value memory, MCP resources and prompt templates.",
    share: "Tool marketplace: publish, browse, install from remote registries and peers.",
    admin: "Operations: execution stats, audit logs, caches, anomaly detection, repair proposals, personas, system status.",
    browser: "Browser automation: navigate, click, type, scrape, screenshots, tabs.",
    lark: "Lark / Feishu docs, sheets, wiki, and sharing: read, create, append, move, and manage permissions."
};

/** Number of MCP gateway tools advertised on tools/list (derived from GATEWAY_DESCRIPTIONS). */
export const GATEWAY_COUNT = Object.keys(GATEWAY_DESCRIPTIONS).length;
