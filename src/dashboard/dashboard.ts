import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs/promises";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { getAllStats } from "../core/history.js";
import { getAuditLogs, logAudit } from "../core/audit.js";
import { listAllPermissions, approveToolCapabilities } from "../core/permissions.js";
import { getCacheStats, clearAllCache, clearCacheForTool } from "../core/cache.js";
import { listSecrets } from "../core/secrets.js";
import { listMemory, clearMemory, setMemory, deleteMemory } from "../core/memory.js";
import { getActiveAnomalies } from "../core/anomaly.js";
import { getMutationCandidates } from "../core/mutation.js";
import { matchIntent } from "../core/intent.js";
import { listAllSchedules } from "../execution/scheduler.js";
import { listAllWebhooks } from "../execution/webhooks.js";
import { listAllPipelines } from "../execution/pipelines.js";
import { listAllAliases } from "../tools/aliases.js";
import { listMarketplace, importFromMarketplace, browseRemote } from "../tools/marketplace.js";
import { getSecret } from "../core/secrets.js";
import { listAllResources } from "../mcp/resources.js";
import { listAllPrompts } from "../mcp/prompts.js";
import { CustomTool } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.resolve(__dirname, "..", "..", "dashboard");
const ASSETS_DIR = path.resolve(DASHBOARD_DIR, "..", "assets");

let dashboardServer: ReturnType<typeof serve> | null = null;

export function startDashboard(
    port: number,
    getTools: () => Map<string, CustomTool>,
    getAllToolFiles: () => Promise<string[]>,
    readToolData: (name: string) => Promise<CustomTool>,
    writeToolData: (tool: CustomTool) => Promise<void>,
    reloadTools: () => Promise<void>,
    installTool: (exportedJson: string) => Promise<{ name: string }>,
    runTool: (name: string, params: Record<string, unknown>) => Promise<{ result: unknown; logs: string[] }>
): void {
    if (dashboardServer) return;

    const app = new Hono();
    const startedAt = Date.now();

    app.get("/health", (c) => {
        return c.json({
            status: "ok",
            uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
            activeTools: getTools().size,
            pid: process.pid
        });
    });

    const dashboardSecret = process.env.DASHBOARD_SECRET;
    if (dashboardSecret) {
        app.use("/api/*", async (c, next) => {
            const auth = c.req.header("Authorization");
            if (!auth || auth !== `Bearer ${dashboardSecret}`) {
                return c.json({ error: "Unauthorized" }, 401);
            }
            await next();
        });
    }

    app.get("/api/tools", async (c) => {
        try {
            const activeTools = getTools();
            const files = await getAllToolFiles();
            const tools = [];

            for (const file of files) {
                const name = file.replace(".json", "");
                try {
                    const tool = await readToolData(name);
                    tools.push({
                        ...tool,
                        active: activeTools.has(name)
                    });
                } catch {
                }
            }

            return c.json(tools);
        } catch {
            return c.json([], 500);
        }
    });

    app.get("/api/stats", async (c) => {
        try {
            const stats = await getAllStats();
            return c.json(stats);
        } catch {
            return c.json({}, 500);
        }
    });

    app.get("/api/audit", async (c) => {
        try {
            const limit = parseInt(c.req.query("limit") || "100");
            const offset = parseInt(c.req.query("offset") || "0") || undefined;
            const toolName = c.req.query("tool") || undefined;
            const logs = await getAuditLogs({ limit, offset, toolName });
            return c.json(logs);
        } catch {
            return c.json([], 500);
        }
    });

    app.get("/api/permissions", async (c) => {
        try {
            const permissions = await listAllPermissions();
            return c.json(permissions);
        } catch {
            return c.json([], 500);
        }
    });

    app.get("/api/cache", async (c) => {
        try {
            const stats = await getCacheStats();
            return c.json(stats);
        } catch {
            return c.json({}, 500);
        }
    });

    app.delete("/api/cache", async (c) => {
        try {
            const tool = c.req.query("tool");
            let cleared: number;
            if (tool) {
                cleared = await clearCacheForTool(tool);
            } else {
                cleared = await clearAllCache();
            }
            return c.json({ cleared });
        } catch {
            return c.json({ error: "Failed to clear cache" }, 500);
        }
    });

    app.post("/api/cache", async (c) => {
        try {
            const body = await c.req.json().catch(() => ({}));
            const tool = body?.tool as string | undefined;
            let cleared: number;
            if (tool) {
                cleared = await clearCacheForTool(tool);
            } else {
                cleared = await clearAllCache();
            }
            return c.json({ cleared });
        } catch {
            return c.json({ error: "Failed to clear cache" }, 500);
        }
    });

    app.post("/api/marketplace/install", async (c) => {
        try {
            const body = await c.req.json();
            const id = body?.id as string | undefined;
            if (!id) {
                return c.json({ error: "Missing 'id' field" }, 400);
            }
            const exported = await importFromMarketplace(id);
            if (!exported) {
                return c.json({ error: `Marketplace entry '${id}' not found` }, 404);
            }
            const result = await installTool(JSON.stringify(exported));
            return c.json({ installed: result.name });
        } catch (err) {
            return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
        }
    });

    app.post("/api/tools/reload", async (c) => {
        try {
            await reloadTools();
            return c.json({ reloaded: true });
        } catch (err) {
            return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
        }
    });

    app.post("/api/tools/:name/deprecate", async (c) => {
        try {
            const name = c.req.param("name");
            const body = await c.req.json().catch(() => ({}));
            const deprecated = body?.deprecated as boolean;
            const reason = body?.reason as string | undefined;

            if (typeof deprecated !== "boolean") {
                return c.json({ error: "'deprecated' boolean field is required" }, 400);
            }

            let tool: CustomTool;
            try {
                tool = await readToolData(name);
            } catch {
                return c.json({ error: `Tool '${name}' not found` }, 404);
            }

            if (deprecated) {
                tool.deprecated = true;
                tool.failingSince = tool.failingSince ?? new Date().toISOString();
            } else {
                tool.deprecated = false;
                delete tool.failingSince;
            }
            tool.updatedAt = new Date().toISOString();

            await writeToolData(tool);
            await logAudit(deprecated ? "tool_deprecated" : "tool_undeprecated", name, { reason });

            return c.json({ name, deprecated, reason });
        } catch (err) {
            return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
        }
    });

    app.post("/api/tools/:name/run", async (c) => {
        try {
            const name = c.req.param("name");
            const body = await c.req.json().catch(() => ({}));
            const params = (body?.params ?? {}) as Record<string, unknown>;

            const activeTools = getTools();
            if (!activeTools.has(name)) {
                return c.json({ error: `Tool '${name}' is not active. Activate it first with save_tool.` }, 404);
            }

            const startTime = Date.now();
            try {
                const { result, logs } = await runTool(name, params);
                const durationMs = Date.now() - startTime;
                return c.json({ success: true, result, logs, durationMs });
            } catch (err) {
                const durationMs = Date.now() - startTime;
                return c.json({
                    success: false,
                    error: err instanceof Error ? err.message : String(err),
                    logs: [],
                    durationMs
                });
            }
        } catch (err) {
            return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
        }
    });

    app.post("/api/tools/:name/approve", async (c) => {
        try {
            const name = c.req.param("name");
            let tool: CustomTool;
            try {
                tool = await readToolData(name);
            } catch {
                return c.json({ error: `Tool '${name}' not found` }, 404);
            }

            await approveToolCapabilities(tool, tool.capabilities);
            await reloadTools();

            return c.json({ success: true });
        } catch (err) {
            return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
        }
    });

    app.put("/api/tools/:name/code", async (c) => {
        try {
            const name = c.req.param("name");
            const body = await c.req.json().catch(() => ({}));
            const code = body?.code as string;

            if (!code) return c.json({ error: "No code provided" }, 400);

            let tool: CustomTool;
            try {
                tool = await readToolData(name);
            } catch {
                return c.json({ error: `Tool '${name}' not found` }, 404);
            }

            tool.code = code;
            tool.updatedAt = new Date().toISOString();
            tool.version += 1;

            await writeToolData(tool);
            await reloadTools();

            return c.json({ success: true, version: tool.version });
        } catch (err) {
            return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
        }
    });

    app.get("/api/secrets", async (c) => {
        try {
            const secrets = await listSecrets();
            return c.json(secrets);
        } catch {
            return c.json([], 500);
        }
    });

    app.get("/api/memory", async (c) => {
        try {
            const namespace = c.req.query("namespace") || undefined;
            const entries = await listMemory(namespace);
            return c.json(entries);
        } catch {
            return c.json([], 500);
        }
    });

    app.delete("/api/memory", async (c) => {
        try {
            const namespace = c.req.query("namespace") || undefined;
            const count = await clearMemory(namespace);
            return c.json({ cleared: count });
        } catch {
            return c.json({ error: "Failed to clear memory" }, 500);
        }
    });

    app.post("/api/memory/set", async (c) => {
        try {
            const body = await c.req.json();
            const { key, value, namespace, ttl_seconds } = body as {
                key: string; value: string; namespace?: string; ttl_seconds?: number;
            };
            if (!key || value === undefined) {
                return c.json({ error: "'key' and 'value' are required" }, 400);
            }
            await setMemory(key, value, namespace, ttl_seconds);
            return c.json({ key, namespace: namespace || "default" });
        } catch (err) {
            return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
        }
    });

    app.post("/api/memory/delete", async (c) => {
        try {
            const body = await c.req.json();
            const { key, namespace } = body as { key: string; namespace?: string };
            if (!key) {
                return c.json({ error: "'key' is required" }, 400);
            }
            const deleted = await deleteMemory(key, namespace);
            return c.json({ deleted });
        } catch (err) {
            return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
        }
    });

    app.post("/api/tools/match", async (c) => {
        try {
            const body = await c.req.json();
            const { query } = body as { query: string };
            if (!query) {
                return c.json({ error: "'query' is required" }, 400);
            }

            const files = await getAllToolFiles();
            const tools = await Promise.all(
                files.map(f => readToolData(f.replace(".json", "")))
            );

            const result = matchIntent(query, tools);
            return c.json(result);
        } catch (err) {
            return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
        }
    });

    app.get("/api/anomalies", async (c) => {
        try {
            const anomalies = await getActiveAnomalies();
            return c.json(anomalies);
        } catch {
            return c.json([], 500);
        }
    });

    app.get("/api/mutations", async (c) => {
        try {
            const candidates = await getMutationCandidates();
            return c.json(candidates);
        } catch {
            return c.json([], 500);
        }
    });

    app.get("/api/schedules", async (c) => {
        try {
            const schedules = await listAllSchedules();
            return c.json(schedules);
        } catch {
            return c.json([], 500);
        }
    });

    app.get("/api/webhooks", async (c) => {
        try {
            const webhooks = await listAllWebhooks();
            return c.json(webhooks);
        } catch {
            return c.json([], 500);
        }
    });

    app.get("/api/pipelines", async (c) => {
        try {
            const pipelines = await listAllPipelines();
            return c.json(pipelines);
        } catch {
            return c.json([], 500);
        }
    });

    app.get("/api/aliases", async (c) => {
        try {
            const aliases = await listAllAliases();
            return c.json(aliases);
        } catch {
            return c.json([], 500);
        }
    });

    app.get("/api/marketplace", async (c) => {
        try {
            const local = await listMarketplace();
            let remote: Awaited<ReturnType<typeof browseRemote>> = [];
            try {
                const token = await getSecret("GITHUB_TOKEN");
                if (token) {
                    remote = await browseRemote(token);
                }
            } catch {
                /* remote optional */
            }
            const byId = new Map<string, unknown>();
            for (const e of [...remote, ...local]) {
                byId.set((e as any).id ?? (e as any).name, e);
            }
            return c.json(Array.from(byId.values()));
        } catch {
            return c.json([], 500);
        }
    });

    app.get("/api/resources", async (c) => {
        try {
            const resources = await listAllResources();
            return c.json(resources);
        } catch {
            return c.json([], 500);
        }
    });

    app.get("/api/prompts", async (c) => {
        try {
            const prompts = await listAllPrompts();
            return c.json(prompts);
        } catch {
            return c.json([], 500);
        }
    });

    app.get("/api/overview", async (c) => {
        try {
            const activeTools = getTools();
            const files = await getAllToolFiles();
            const stats = await getAllStats();
            const cacheStats = await getCacheStats();
            const schedules = await listAllSchedules();
            const webhooks = await listAllWebhooks();
            const pipelines = await listAllPipelines();
            const aliases = await listAllAliases();
            const anomalies = await getActiveAnomalies();

            let totalCalls = 0;
            let totalSuccess = 0;
            let totalFailed = 0;

            for (const s of Object.values(stats)) {
                totalCalls += s.totalCalls;
                totalSuccess += s.successfulCalls;
                totalFailed += s.failedCalls;
            }

            return c.json({
                totalTools: files.length,
                activeTools: activeTools.size,
                totalCalls,
                totalSuccess,
                totalFailed,
                cacheHitRate: cacheStats.hitRate,
                schedulesCount: schedules.length,
                webhooksCount: webhooks.length,
                pipelinesCount: pipelines.length,
                aliasesCount: aliases.length,
                anomaliesCount: anomalies.length
            });
        } catch {
            return c.json({}, 500);
        }
    });

    app.get("/*", async (c) => {
        const reqPath = c.req.path === "/" ? "/index.html" : c.req.path;
        let filePath = path.join(DASHBOARD_DIR, reqPath);

        if (reqPath.startsWith("/assets/")) {
            const fileName = reqPath.replace(/^\/assets\//, "");
            filePath = path.join(ASSETS_DIR, fileName);
        }

        try {
            const content = await fs.readFile(filePath);
            const ext = path.extname(filePath);
            const mimeTypes: Record<string, string> = {
                ".html": "text/html",
                ".css": "text/css",
                ".js": "application/javascript",
                ".json": "application/json",
                ".png": "image/png",
                ".svg": "image/svg+xml",
                ".ico": "image/x-icon",
                ".webp": "image/webp"
            };
            const contentType = mimeTypes[ext] || "application/octet-stream";
            return new Response(content, {
                headers: { "Content-Type": contentType }
            });
        } catch {
            // Missing static/asset files must not fall through to the SPA shell
            if (reqPath.startsWith("/assets/") || /\.(js|css|png|svg|ico|webp|map)$/i.test(reqPath)) {
                return c.text("Not found", 404);
            }
            const indexPath = path.join(DASHBOARD_DIR, "index.html");
            try {
                const content = await fs.readFile(indexPath);
                return new Response(content, {
                    headers: { "Content-Type": "text/html" }
                });
            } catch {
                return c.text("Dashboard not found", 404);
            }
        }
    });

    try {
        dashboardServer = serve({ fetch: app.fetch, port });
        console.error(`Dashboard started on http://localhost:${port}`);
    } catch (err) {
        console.error(`Dashboard failed to start on port ${port}: ${err instanceof Error ? err.message : String(err)}`);
        dashboardServer = null;
    }
}

export function stopDashboard(): void {
    if (dashboardServer) {
        dashboardServer.close();
        dashboardServer = null;
    }
}
