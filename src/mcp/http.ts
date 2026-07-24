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
}

let httpServer: ReturnType<typeof serve> | null = null;
const transports: Record<string, Transport> = {};

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

    app.get("/health", (c) => c.json({ status: "ok", service: "architect-mcp-http" }));

    const handleMcp = async (c: any) => {
        const req: Request = c.req.raw;
        if (!checkAuth(req, opts.authSecret)) {
            return unauthorized();
        }

        const sessionId = req.headers.get("mcp-session-id");

        try {
            let transport: Transport | undefined;

            if (sessionId && transports[sessionId]) {
                transport = transports[sessionId];
                return await transport.handleRequest(req);
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
                    transport = new WebStandardStreamableHTTPServerTransport({
                        sessionIdGenerator: () => randomUUID(),
                        onsessioninitialized: (sid) => {
                            transports[sid] = transport!;
                        }
                    });
                    transport.onclose = () => {
                        const sid = transport?.sessionId;
                        if (sid && transports[sid]) delete transports[sid];
                    };

                    const server = opts.createServer();
                    await server.connect(transport);
                    return await transport.handleRequest(req, { parsedBody: body });
                }

                if (sessionId && transports[sessionId]) {
                    return await transports[sessionId].handleRequest(req, { parsedBody: body });
                }

                return new Response(JSON.stringify({
                    jsonrpc: "2.0",
                    error: { code: -32000, message: "Bad Request: No valid session ID provided" },
                    id: null
                }), { status: 400, headers: { "Content-Type": "application/json" } });
            }

            if (req.method === "GET" || req.method === "DELETE") {
                if (!sessionId || !transports[sessionId]) {
                    return new Response("Invalid or missing session ID", { status: 400 });
                }
                return await transports[sessionId].handleRequest(req);
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
        console.error(`MCP HTTP transport on http://localhost:${opts.port}/mcp`);
    } catch (err) {
        console.error(`MCP HTTP failed to start on port ${opts.port}: ${err instanceof Error ? err.message : String(err)}`);
        httpServer = null;
    }
}

export function stopMcpHttpServer(): void {
    for (const sid of Object.keys(transports)) {
        try {
            void transports[sid].close();
        } catch { /* ignore */ }
        delete transports[sid];
    }
    if (httpServer) {
        httpServer.close();
        httpServer = null;
    }
}
