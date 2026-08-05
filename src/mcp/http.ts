import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

type Transport = WebStandardStreamableHTTPServerTransport;

export interface McpHttpOptions {
    port: number;
    /** Shared secret for Bearer auth. If unset, endpoint is open (not recommended). */
    authSecret?: string;
    /** Build a fully configured McpServer (gateways + custom tools). */
    createServer: () => McpServer;
    /** Remove a session server from caller-owned tracking after its transport closes. */
    disposeServer?: (server: McpServer) => void;
    /** Close abandoned sessions after this idle period. Defaults to 15 minutes. */
    sessionIdleTimeoutMs?: number;
}

let httpServer: ReturnType<typeof serve> | null = null;
interface SessionState {
    transport: Transport;
    server: McpServer;
    lastActivityAt: number;
    activeRequests: number;
}

const sessions: Record<string, SessionState> = {};
let sessionSweepInterval: ReturnType<typeof setInterval> | null = null;
let disposeSessionServer: ((server: McpServer) => void) | undefined;

function removeSession(sessionId: string, closeTransport = false): void {
    const session = sessions[sessionId];
    if (!session) return;
    delete sessions[sessionId];
    disposeSessionServer?.(session.server);
    if (closeTransport) {
        void session.transport.close().catch(() => { });
    }
}

async function handleSessionRequest(
    session: SessionState,
    req: Request,
    options?: Parameters<Transport["handleRequest"]>[1]
): Promise<Response> {
    session.lastActivityAt = Date.now();
    session.activeRequests++;
    try {
        return await session.transport.handleRequest(req, options);
    } finally {
        session.activeRequests--;
        session.lastActivityAt = Date.now();
    }
}

function unauthorized(): Response {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": 'Bearer realm="architect-mcp"'
        }
    });
}

function checkAuth(req: Request, secret?: string): boolean {
    if (!secret) return true;
    const auth = req.headers.get("Authorization") || "";
    return auth === `Bearer ${secret}`;
}

export function startMcpHttpServer(opts: McpHttpOptions): void {
    if (httpServer) return;
    if (!opts.authSecret || !opts.authSecret.trim()) {
        throw new Error("startMcpHttpServer requires a non-empty authSecret");
    }

    const app = new Hono();
    const idleTimeoutMs = opts.sessionIdleTimeoutMs ?? 15 * 60 * 1000;
    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 1000) {
        throw new Error("sessionIdleTimeoutMs must be at least 1000 milliseconds");
    }
    disposeSessionServer = opts.disposeServer;

    app.use(
        "*",
        cors({
            origin: "*",
            allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
            allowHeaders: [
                "Content-Type",
                "Authorization",
                "mcp-session-id",
                "Last-Event-ID",
                "mcp-protocol-version"
            ],
            exposeHeaders: ["mcp-session-id", "mcp-protocol-version"]
        })
    );

    app.get("/health", (c) => c.json({
        status: "ok",
        service: "architect-mcp-http",
        activeSessions: Object.keys(sessions).length,
        sessionIdleTimeoutMs: idleTimeoutMs
    }));

    const handleMcp = async (c: any) => {
        const req: Request = c.req.raw;
        if (!checkAuth(req, opts.authSecret)) {
            return unauthorized();
        }

        const sessionId = req.headers.get("mcp-session-id");

        try {
            let transport: Transport | undefined;

            if (sessionId && sessions[sessionId]) {
                return await handleSessionRequest(sessions[sessionId], req);
            }

            if (req.method === "POST") {
                let body: unknown;
                try {
                    body = await req.json();
                } catch {
                    return new Response(JSON.stringify({
                        jsonrpc: "2.0",
                        error: { code: -32700, message: "Parse error" },
                        id: null
                    }), { status: 400, headers: { "Content-Type": "application/json" } });
                }

                if (!sessionId && isInitializeRequest(body)) {
                    const server = opts.createServer();
                    transport = new WebStandardStreamableHTTPServerTransport({
                        sessionIdGenerator: () => randomUUID(),
                        onsessioninitialized: (sid) => {
                            sessions[sid] = {
                                transport: transport!,
                                server,
                                lastActivityAt: Date.now(),
                                activeRequests: 0
                            };
                        }
                    });
                    transport.onclose = () => {
                        const sid = transport?.sessionId;
                        if (sid) removeSession(sid);
                    };

                    try {
                        await server.connect(transport);
                    } catch (err) {
                        disposeSessionServer?.(server);
                        throw err;
                    }
                    return await transport.handleRequest(req, { parsedBody: body });
                }

                if (sessionId && sessions[sessionId]) {
                    return await handleSessionRequest(sessions[sessionId], req, { parsedBody: body });
                }

                return new Response(JSON.stringify({
                    jsonrpc: "2.0",
                    error: { code: -32000, message: "Bad Request: No valid session ID provided" },
                    id: null
                }), { status: 400, headers: { "Content-Type": "application/json" } });
            }

            if (req.method === "GET" || req.method === "DELETE") {
                if (!sessionId || !sessions[sessionId]) {
                    return new Response("Invalid or missing session ID", { status: 400 });
                }
                return await handleSessionRequest(sessions[sessionId], req);
            }

            return new Response("Method Not Allowed", { status: 405 });
        } catch (err) {
            console.error("MCP HTTP error:", err instanceof Error ? err.message : err);
            return new Response(JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32603, message: "Internal server error" },
                id: null
            }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
    };

    app.all("/mcp", handleMcp);
    app.all("/mcp/*", handleMcp);

    try {
        httpServer = serve({ fetch: app.fetch, port: opts.port });
        sessionSweepInterval = setInterval(() => {
            const cutoff = Date.now() - idleTimeoutMs;
            for (const [sessionId, session] of Object.entries(sessions)) {
                if (session.activeRequests === 0 && session.lastActivityAt < cutoff) {
                    removeSession(sessionId, true);
                }
            }
        }, Math.min(60_000, idleTimeoutMs));
        sessionSweepInterval.unref?.();
        console.error(`MCP HTTP transport on http://localhost:${opts.port}/mcp`);
    } catch (err) {
        console.error(`MCP HTTP failed to start on port ${opts.port}: ${err instanceof Error ? err.message : String(err)}`);
        httpServer = null;
    }
}

export function stopMcpHttpServer(): void {
    if (sessionSweepInterval) {
        clearInterval(sessionSweepInterval);
        sessionSweepInterval = null;
    }
    for (const sid of Object.keys(sessions)) {
        removeSession(sid, true);
    }
    disposeSessionServer = undefined;
    if (httpServer) {
        httpServer.close();
        httpServer = null;
    }
}
