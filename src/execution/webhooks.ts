import * as crypto from "crypto";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebhookConfig } from "../types.js";
import { getDb } from "../core/db.js";

let webhookServer: ReturnType<typeof serve> | null = null;
let webhookApp: Hono | null = null;
let webhookExecutor: ((toolName: string, params: Record<string, unknown>) => Promise<any>) | null = null;

function rowToWebhook(row: any): WebhookConfig {
    return {
        id: row.id,
        toolName: row.tool_name,
        path: row.path,
        method: row.method,
        secret: row.secret || undefined,
        enabled: row.enabled === 1,
        createdAt: row.created_at
    };
}

export async function createWebhook(config: {
    toolName: string;
    path: string;
    method: "GET" | "POST";
    secret?: string;
}): Promise<WebhookConfig> {
    const db = getDb();
    const id = `wh_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    let webhookPath = config.path;
    if (!webhookPath.startsWith("/")) {
        webhookPath = "/" + webhookPath;
    }

    const webhook: WebhookConfig = {
        id,
        toolName: config.toolName,
        path: webhookPath,
        method: config.method,
        secret: config.secret,
        enabled: true,
        createdAt: new Date().toISOString()
    };

    db.prepare(
        `INSERT INTO webhooks (id, tool_name, path, method, secret, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
    ).run(id, webhook.toolName, webhook.path, webhook.method, webhook.secret || null, webhook.createdAt);

    return webhook;
}

export async function deleteWebhook(id: string): Promise<boolean> {
    const db = getDb();
    const result = db.prepare("DELETE FROM webhooks WHERE id = ?").run(id);
    return result.changes > 0;
}

export async function listAllWebhooks(): Promise<WebhookConfig[]> {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM webhooks").all() as any[];
    return rows.map(rowToWebhook);
}

async function handleWebhookRequest(
    webhookPath: string,
    method: string,
    body: any,
    headers: Record<string, string>
): Promise<{ status: number; body: any }> {
    if (!webhookExecutor) {
        return { status: 503, body: { error: "Webhook executor not initialized" } };
    }

    const db = getDb();
    const row = db.prepare("SELECT * FROM webhooks WHERE path = ? AND method = ? AND enabled = 1").get(webhookPath, method) as any;

    if (!row) {
        return { status: 404, body: { error: "Webhook not found" } };
    }

    if (row.secret) {
        const providedSecret = headers["x-webhook-secret"] || "";
        const expected = Buffer.from(row.secret);
        const provided = Buffer.from(providedSecret);
        if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
            return { status: 401, body: { error: "Invalid webhook secret" } };
        }
    }

    try {
        const params = typeof body === "object" && body !== null ? body : {};
        const result = await webhookExecutor(row.tool_name, params);
        return { status: 200, body: { success: true, result } };
    } catch (err) {
        return {
            status: 500,
            body: { success: false, error: err instanceof Error ? err.message : String(err) }
        };
    }
}

export function startWebhookServer(
    port: number,
    executor: (toolName: string, params: Record<string, unknown>) => Promise<any>
): void {
    if (webhookServer) return;

    webhookExecutor = executor;
    webhookApp = new Hono();

    webhookApp.all("/webhook/*", async (c) => {
        const webhookPath = "/" + c.req.path.replace(/^\/webhook/, "").replace(/^\//, "");
        const method = c.req.method;
        let body: any = {};

        try {
            if (method === "POST") {
                body = await c.req.json();
            } else {
                const query = c.req.query();
                body = query;
            }
        } catch {
        }

        const headers: Record<string, string> = {};
        c.req.raw.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
        });

        const result = await handleWebhookRequest(webhookPath, method, body, headers);
        return c.json(result.body, result.status as any);
    });

    webhookApp.get("/health", (c) => c.json({ status: "ok" }));

    try {
        webhookServer = serve({ fetch: webhookApp.fetch, port });
        console.error(`Webhook server started on port ${port}`);
    } catch (err) {
        console.error(`Webhook server failed to start on port ${port}: ${err instanceof Error ? err.message : String(err)}`);
        webhookServer = null;
        webhookApp = null;
        webhookExecutor = null;
    }
}

export function stopWebhookServer(): void {
    if (webhookServer) {
        webhookServer.close();
        webhookServer = null;
        webhookApp = null;
        webhookExecutor = null;
    }
}

export function formatWebhook(webhook: WebhookConfig): string {
    const status = webhook.enabled ? "ENABLED" : "DISABLED";
    return [
        `[${status}] ${webhook.id}`,
        `  Tool: ${webhook.toolName}`,
        `  Path: /webhook${webhook.path}`,
        `  Method: ${webhook.method}`,
        `  Secret: ${webhook.secret ? "configured" : "none"}`
    ].join("\n");
}
