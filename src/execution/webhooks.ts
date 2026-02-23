import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import * as crypto from "crypto";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { WebhookConfig, WebhookStore } from "../types.js";
import { fileExists } from "../core/utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBHOOKS_FILE = path.resolve(__dirname, "..", "webhooks.json");
const WEBHOOKS_SCHEMA_VERSION = 1;

let webhookServer: ReturnType<typeof serve> | null = null;
let webhookApp: Hono | null = null;
let webhookExecutor: ((toolName: string, params: Record<string, unknown>) => Promise<any>) | null = null;



export async function loadWebhooks(): Promise<WebhookStore> {
    if (!await fileExists(WEBHOOKS_FILE)) {
        return { version: WEBHOOKS_SCHEMA_VERSION, webhooks: {} };
    }

    try {
        const content = await fs.readFile(WEBHOOKS_FILE, "utf-8");
        const data = JSON.parse(content) as WebhookStore;
        return {
            version: data.version || WEBHOOKS_SCHEMA_VERSION,
            webhooks: data.webhooks || {}
        };
    } catch {
        return { version: WEBHOOKS_SCHEMA_VERSION, webhooks: {} };
    }
}

export async function saveWebhooks(store: WebhookStore): Promise<void> {
    await fs.writeFile(WEBHOOKS_FILE, JSON.stringify(store, null, 2));
}

export async function createWebhook(config: {
    toolName: string;
    path: string;
    method: "GET" | "POST";
    secret?: string;
}): Promise<WebhookConfig> {
    const store = await loadWebhooks();
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

    store.webhooks[id] = webhook;
    await saveWebhooks(store);
    return webhook;
}

export async function deleteWebhook(id: string): Promise<boolean> {
    const store = await loadWebhooks();
    if (!store.webhooks[id]) return false;
    delete store.webhooks[id];
    await saveWebhooks(store);
    return true;
}

export async function listAllWebhooks(): Promise<WebhookConfig[]> {
    const store = await loadWebhooks();
    return Object.values(store.webhooks);
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

    const store = await loadWebhooks();
    const webhook = Object.values(store.webhooks).find(
        w => w.path === webhookPath && w.method === method && w.enabled
    );

    if (!webhook) {
        return { status: 404, body: { error: "Webhook not found" } };
    }

    if (webhook.secret) {
        const providedSecret = headers["x-webhook-secret"] || "";
        const expected = Buffer.from(webhook.secret);
        const provided = Buffer.from(providedSecret);
        if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
            return { status: 401, body: { error: "Invalid webhook secret" } };
        }
    }

    try {
        const params = typeof body === "object" && body !== null ? body : {};
        const result = await webhookExecutor(webhook.toolName, params);
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
