import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs/promises";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getAllStats } from "../core/history.js";
import { getAuditLogs } from "../core/audit.js";
import { listAllPermissions } from "../core/permissions.js";
import { getCacheStats, clearAllCache, clearCacheForTool } from "../core/cache.js";
import { listSecrets } from "../core/secrets.js";
import { listAllSchedules } from "../execution/scheduler.js";
import { listAllWebhooks } from "../execution/webhooks.js";
import { listAllPipelines } from "../execution/pipelines.js";
import { listAllAliases } from "../tools/aliases.js";
import { listMarketplace } from "../tools/marketplace.js";
import { listAllResources } from "../mcp/resources.js";
import { listAllPrompts } from "../mcp/prompts.js";
import { CustomTool } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.resolve(__dirname, "..", "dashboard");

let dashboardServer: ReturnType<typeof serve> | null = null;

export function startDashboard(
    port: number,
    getTools: () => Map<string, CustomTool>,
    getAllToolFiles: () => Promise<string[]>,
    readToolData: (name: string) => Promise<CustomTool>
): void {
    if (dashboardServer) return;

    const app = new Hono();

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
            const toolName = c.req.query("tool") || undefined;
            const logs = await getAuditLogs({ limit, toolName });
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

    app.get("/api/secrets", async (c) => {
        try {
            const secrets = await listSecrets();
            return c.json(secrets);
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
            const entries = await listMarketplace();
            return c.json(entries);
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
                aliasesCount: aliases.length
            });
        } catch {
            return c.json({}, 500);
        }
    });

    app.get("/*", async (c) => {
        const reqPath = c.req.path === "/" ? "/index.html" : c.req.path;
        const filePath = path.join(DASHBOARD_DIR, reqPath);

        try {
            const content = await fs.readFile(filePath);
            const ext = path.extname(filePath);
            const mimeTypes: Record<string, string> = {
                ".html": "text/html",
                ".css": "text/css",
                ".js": "application/javascript",
                ".json": "application/json",
                ".png": "image/png",
                ".svg": "image/svg+xml"
            };
            const contentType = mimeTypes[ext] || "application/octet-stream";
            return new Response(content, {
                headers: { "Content-Type": contentType }
            });
        } catch {
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

    dashboardServer = serve({ fetch: app.fetch, port });
    console.error(`Dashboard started on http://localhost:${port}`);
}

export function stopDashboard(): void {
    if (dashboardServer) {
        dashboardServer.close();
        dashboardServer = null;
    }
}
