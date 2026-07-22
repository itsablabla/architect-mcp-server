import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BeeperDesktopClient, BeeperDesktopError } from "./client.js";

function textResult(data: unknown) {
    const text =
        typeof data === "string"
            ? data
            : JSON.stringify(data, null, 2);
    return {
        content: [{ type: "text" as const, text }]
    };
}

function errorResult(err: unknown) {
    if (err instanceof BeeperDesktopError) {
        const details =
            err.body === undefined
                ? ""
                : `\n${typeof err.body === "string" ? err.body : JSON.stringify(err.body, null, 2)}`;
        return {
            content: [
                {
                    type: "text" as const,
                    text: `${err.message}${details}`
                }
            ],
            isError: true as const
        };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
        content: [{ type: "text" as const, text: message }],
        isError: true as const
    };
}

export function createBeeperDesktopMcpServer(client?: BeeperDesktopClient): McpServer {
    const c = client ?? new BeeperDesktopClient();
    const server = new McpServer(
        {
            name: "beeper-desktop-mcp",
            version: "1.0.0"
        },
        {
            capabilities: {
                tools: {}
            }
        }
    );

    // ---- Convenience / health tools ----
    server.registerTool(
        "beeper_health",
        {
            description:
                "Check Beeper Desktop API connectivity. Returns endpoint info, account summary, and Desktop MCP tool names.",
            inputSchema: z.object({})
        },
        async () => {
            try {
                const health = await c.health();
                const accounts = await c.listAccountsRest();
                let tools: any = null;
                try {
                    tools = await c.mcpToolsList();
                } catch (err) {
                    tools = {
                        error: err instanceof Error ? err.message : String(err)
                    };
                }
                const list = Array.isArray(accounts) ? accounts : [];
                return textResult({
                    ok: true,
                    baseUrl: c.baseUrl,
                    mcpUrl: c.mcpUrl,
                    token_fp: `${c.accessToken.slice(0, 5)}…${c.accessToken.slice(-4)}`,
                    health,
                    account_count: list.length,
                    accounts: list.map((a: any) => ({
                        accountID: a.accountID,
                        network: a.network,
                        status: a.status
                    })),
                    desktop_mcp: {
                        tool_count: Array.isArray(tools?.tools) ? tools.tools.length : null,
                        tools: Array.isArray(tools?.tools)
                            ? tools.tools.map((t: any) => t.name)
                            : tools
                    }
                });
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    server.registerTool(
        "list_chats",
        {
            description:
                "List recent chats via Desktop REST /v1/chats. Optional limit/cursor pagination.",
            inputSchema: z.object({
                limit: z.number().int().min(1).max(100).optional(),
                cursor: z.string().optional()
            })
        },
        async ({ limit, cursor }) => {
            try {
                const q: Record<string, unknown> = {};
                if (limit != null) q.limit = limit;
                if (cursor) q.cursor = cursor;
                return textResult(await c.listChatsRest(q));
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    server.registerTool(
        "desktop_tools",
        {
            description:
                "List official Beeper Desktop MCP tools exposed by the local Desktop API (/v0/mcp).",
            inputSchema: z.object({})
        },
        async () => {
            try {
                return textResult(await c.mcpToolsList());
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    // ---- Official Desktop MCP tools (proxied) ----
    server.registerTool(
        "focus_app",
        {
            description:
                "Focus Beeper Desktop and optionally navigate to a specific chat, message, or pre-fill draft text and attachment.",
            inputSchema: z.object({
                chatID: z.string().optional(),
                messageID: z.string().optional(),
                draftText: z.string().optional(),
                draftAttachmentPath: z.string().optional()
            })
        },
        async (args) => {
            try {
                return textResult(await c.mcpCall("focus_app", args));
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    server.registerTool(
        "search",
        {
            description:
                "Search for chats, participant name matches in groups, and the first page of messages in one call.",
            inputSchema: z.object({
                query: z.string().describe("Literal word matching (NOT semantic).")
            })
        },
        async ({ query }) => {
            try {
                return textResult(await c.mcpCall("search", { query }));
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    server.registerTool(
        "get_accounts",
        {
            description: "List connected accounts on this device.",
            inputSchema: z.object({})
        },
        async () => {
            try {
                return textResult(await c.mcpCall("get_accounts", {}));
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    server.registerTool(
        "get_chat",
        {
            description:
                "Get chat details: metadata, participants (limited), last activity.",
            inputSchema: z.object({
                chatID: z.string(),
                maxParticipantCount: z.number().int().optional()
            })
        },
        async (args) => {
            try {
                return textResult(await c.mcpCall("get_chat", args));
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    server.registerTool(
        "archive_chat",
        {
            description: "Archive or unarchive a chat.",
            inputSchema: z.object({
                chatID: z.string(),
                archived: z.boolean().optional()
            })
        },
        async (args) => {
            try {
                return textResult(await c.mcpCall("archive_chat", args));
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    server.registerTool(
        "search_chats",
        {
            description:
                "Search chats by title/network or participants using Beeper Desktop's renderer algorithm.",
            inputSchema: z.object({
                query: z.string().optional(),
                accountIDs: z.array(z.string()).optional(),
                cursor: z.string().optional(),
                direction: z.enum(["after", "before"]).optional(),
                inbox: z.enum(["primary", "low-priority", "archive"]).optional(),
                includeMuted: z.boolean().optional(),
                lastActivityAfter: z.string().optional(),
                lastActivityBefore: z.string().optional(),
                limit: z.number().int().optional(),
                scope: z.string().optional(),
                type: z.string().optional(),
                unreadOnly: z.boolean().optional()
            })
        },
        async (args) => {
            try {
                return textResult(await c.mcpCall("search_chats", args));
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    server.registerTool(
        "set_chat_reminder",
        {
            description: "Set a reminder for a chat at a specific time.",
            inputSchema: z.object({
                chatID: z.string(),
                reminder: z.union([z.string(), z.number(), z.record(z.string(), z.unknown())])
            })
        },
        async (args) => {
            try {
                return textResult(await c.mcpCall("set_chat_reminder", args));
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    server.registerTool(
        "clear_chat_reminder",
        {
            description: "Clear a chat reminder.",
            inputSchema: z.object({
                chatID: z.string()
            })
        },
        async (args) => {
            try {
                return textResult(await c.mcpCall("clear_chat_reminder", args));
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    server.registerTool(
        "list_messages",
        {
            description:
                "List messages from a specific chat with pagination support.",
            inputSchema: z.object({
                chatID: z.string(),
                cursor: z.string().optional(),
                direction: z.enum(["after", "before"]).optional()
            })
        },
        async (args) => {
            try {
                return textResult(await c.mcpCall("list_messages", args));
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    server.registerTool(
        "search_messages",
        {
            description:
                "Search messages across chats using Beeper's message index. Query is LITERAL word matching, not semantic search.",
            inputSchema: z.object({
                query: z.string().optional(),
                accountIDs: z.array(z.string()).optional(),
                chatIDs: z.array(z.string()).optional(),
                chatType: z.string().optional(),
                cursor: z.string().optional(),
                dateAfter: z.string().optional(),
                dateBefore: z.string().optional(),
                direction: z.enum(["after", "before"]).optional(),
                excludeLowPriority: z.boolean().optional(),
                includeMuted: z.boolean().optional(),
                limit: z.number().int().optional(),
                mediaTypes: z.array(z.string()).optional(),
                sender: z.string().optional()
            })
        },
        async (args) => {
            try {
                return textResult(await c.mcpCall("search_messages", args));
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    server.registerTool(
        "send_message",
        {
            description:
                "Send a text message to a specific chat. Supports replying to existing messages.",
            inputSchema: z.object({
                chatID: z.string(),
                text: z.string().optional(),
                replyToMessageID: z.string().optional()
            })
        },
        async (args) => {
            try {
                if (args.chatID === "__dry_run__") {
                    return textResult({ dry_run: true, ok: true });
                }
                if (!args.text) {
                    throw new BeeperDesktopError("text is required");
                }
                return textResult(await c.mcpCall("send_message", args));
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    server.registerTool(
        "search_docs",
        {
            description:
                "Search for documentation for how to use the client to interact with the API.",
            inputSchema: z.object({
                query: z.string(),
                language: z.string().default("en")
            })
        },
        async (args) => {
            try {
                return textResult(await c.mcpCall("search_docs", args));
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    server.registerTool(
        "desktop_mcp_call",
        {
            description:
                "Call any official Beeper Desktop MCP tool by name with a raw args object.",
            inputSchema: z.object({
                tool_name: z.string(),
                args: z.record(z.string(), z.unknown()).optional()
            })
        },
        async ({ tool_name, args }) => {
            try {
                return textResult(await c.mcpCall(tool_name, (args as Record<string, unknown>) || {}));
            } catch (err) {
                return errorResult(err);
            }
        }
    );

    return server;
}

export async function startBeeperDesktopMcpStdio(
    client?: BeeperDesktopClient
): Promise<void> {
    const server = createBeeperDesktopMcpServer(client);
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
