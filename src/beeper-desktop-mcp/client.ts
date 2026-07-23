export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface BeeperDesktopClientOptions {
    baseUrl?: string;
    mcpUrl?: string;
    accessToken?: string;
    fetchImpl?: typeof fetch;
}

export class BeeperDesktopError extends Error {
    constructor(
        message: string,
        readonly status?: number,
        readonly body?: unknown
    ) {
        super(message);
        this.name = "BeeperDesktopError";
    }
}

function trimSlash(url: string): string {
    return url.replace(/\/+$/, "");
}

function joinUrl(base: string, path: string): string {
    if (!path) return base;
    if (!path.startsWith("/")) path = `/${path}`;
    return `${trimSlash(base)}${path}`;
}

async function parseBody(raw: string): Promise<any> {
    const text = String(raw ?? "");
    if (!text.trim()) return null;

    // Prefer full-body JSON first so scalars ("ok", true, 0, null) are preserved.
    try {
        return JSON.parse(text);
    } catch {
        /* fall through to SSE / raw handling */
    }

    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith("data: ")) {
            try {
                return JSON.parse(line.slice(6));
            } catch {
                /* continue */
            }
        } else if (line.startsWith("data:")) {
            try {
                return JSON.parse(line.slice(5).trim());
            } catch {
                /* continue */
            }
        }
    }
    return { raw: text.slice(0, 2000) };
}

export class BeeperDesktopClient {
    readonly baseUrl: string;
    readonly mcpUrl: string;
    readonly accessToken: string;
    private readonly fetchImpl: typeof fetch;
    private mcpSessionId: string | null = null;
    private mcpInitialized = false;

    constructor(opts: BeeperDesktopClientOptions = {}) {
        const token =
            opts.accessToken ||
            process.env.BEEPER_DESKTOP_TOKEN ||
            process.env.BEEPER_ACCESS_TOKEN ||
            process.env.BEEPER_TOKEN ||
            "";
        if (!token) {
            throw new BeeperDesktopError(
                "Missing Beeper Desktop token. Set BEEPER_DESKTOP_TOKEN (bdapi_…)."
            );
        }

        const base =
            opts.baseUrl ||
            process.env.BEEPER_DESKTOP_URL ||
            process.env.BEEPER_BASE_URL ||
            "http://127.0.0.1:23373";

        this.baseUrl = trimSlash(base);
        this.mcpUrl =
            opts.mcpUrl ||
            process.env.BEEPER_DESKTOP_MCP_URL ||
            `${this.baseUrl}/v0/mcp`;
        this.accessToken = token.trim();
        this.fetchImpl = opts.fetchImpl || fetch;
    }

    private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
        return {
            Authorization: `Bearer ${this.accessToken}`,
            Accept: "application/json, text/event-stream",
            ...extra
        };
    }

    async rest<T = any>(
        method: string,
        path: string,
        query?: Record<string, unknown>,
        body?: unknown
    ): Promise<T> {
        let url = joinUrl(this.baseUrl, path);
        if (query && Object.keys(query).length > 0) {
            const qs = Object.entries(query)
                .filter(([, v]) => v !== undefined && v !== null && v !== "")
                .map(([k, v]) => {
                    const val = typeof v === "object" ? JSON.stringify(v) : String(v);
                    return `${encodeURIComponent(k)}=${encodeURIComponent(val)}`;
                })
                .join("&");
            if (qs) url += (url.includes("?") ? "&" : "?") + qs;
        }

        const headers = this.authHeaders();
        const init: RequestInit = { method: method.toUpperCase(), headers };
        if (body !== undefined) {
            headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(body);
        }

        const res = await this.fetchImpl(url, init);
        const text = await res.text();
        const parsed = await parseBody(text);
        if (!res.ok) {
            throw new BeeperDesktopError(
                `Desktop REST ${method.toUpperCase()} ${path} failed (${res.status})`,
                res.status,
                parsed
            );
        }
        return parsed as T;
    }

    async health(): Promise<any> {
        try {
            return await this.rest("GET", "/health");
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }

    async listAccountsRest(): Promise<any> {
        return this.rest("GET", "/v1/accounts");
    }

    async listChatsRest(query: Record<string, unknown> = {}): Promise<any> {
        return this.rest("GET", "/v1/chats", query);
    }

    private async ensureMcpSession(): Promise<Record<string, string>> {
        const headers = this.authHeaders({ "Content-Type": "application/json" });
        if (this.mcpSessionId) headers["mcp-session-id"] = this.mcpSessionId;

        if (!this.mcpInitialized) {
            const initRes = await this.fetchImpl(this.mcpUrl, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "initialize",
                    params: {
                        protocolVersion: "2024-11-05",
                        capabilities: {},
                        clientInfo: { name: "beeper-desktop-mcp", version: "1.0.0" }
                    }
                })
            });
            const initText = await initRes.text();
            const initMsg = await parseBody(initText);
            if (!initRes.ok) {
                throw new BeeperDesktopError(
                    `Desktop MCP initialize failed (${initRes.status})`,
                    initRes.status,
                    initMsg
                );
            }
            if (initMsg?.error) {
                throw new BeeperDesktopError(
                    `Desktop MCP initialize error: ${JSON.stringify(initMsg.error)}`,
                    initRes.status,
                    initMsg.error
                );
            }

            const sid =
                initRes.headers.get("mcp-session-id") ||
                initRes.headers.get("Mcp-Session-Id");
            if (sid) {
                this.mcpSessionId = sid;
                headers["mcp-session-id"] = sid;
            }

            try {
                await this.fetchImpl(this.mcpUrl, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        method: "notifications/initialized"
                    })
                });
            } catch {
                /* optional */
            }
            this.mcpInitialized = true;
        }

        return headers;
    }

    async mcpToolsList(): Promise<any> {
        const headers = await this.ensureMcpSession();
        const res = await this.fetchImpl(this.mcpUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                method: "tools/list",
                params: {}
            })
        });
        const text = await res.text();
        const msg = await parseBody(text);
        if (!res.ok) {
            throw new BeeperDesktopError(
                `Desktop MCP tools/list failed (${res.status})`,
                res.status,
                msg
            );
        }
        if (msg?.error) {
            throw new BeeperDesktopError(
                `Desktop MCP tools/list error: ${JSON.stringify(msg.error)}`,
                res.status,
                msg.error
            );
        }
        return msg?.result ?? msg;
    }

    async mcpCall(toolName: string, args: Record<string, unknown> = {}): Promise<any> {
        const headers = await this.ensureMcpSession();
        const res = await this.fetchImpl(this.mcpUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 3,
                method: "tools/call",
                params: { name: toolName, arguments: args }
            })
        });
        const text = await res.text();
        const msg = await parseBody(text);
        if (!res.ok) {
            throw new BeeperDesktopError(
                `Desktop MCP tools/call ${toolName} failed (${res.status})`,
                res.status,
                msg
            );
        }
        if (msg?.error) {
            throw new BeeperDesktopError(
                `Desktop MCP tools/call ${toolName} error: ${JSON.stringify(msg.error)}`,
                res.status,
                msg.error
            );
        }

        // Prefer official structured payloads over free-form text blocks.
        if (msg?.result?.structuredContent !== undefined) {
            return msg.result.structuredContent;
        }

        const content = msg?.result?.content;
        if (Array.isArray(content)) {
            const texts = content
                .filter((x: any) => x && x.type === "text")
                .map((x: any) => x.text);
            if (texts.length === 1) {
                try {
                    return JSON.parse(texts[0]);
                } catch {
                    return { text: texts[0] };
                }
            }
            return msg.result;
        }
        return msg?.result !== undefined ? msg.result : msg;
    }

    resetMcpSession(): void {
        this.mcpSessionId = null;
        this.mcpInitialized = false;
    }
}
