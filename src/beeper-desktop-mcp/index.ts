#!/usr/bin/env node
import { startBeeperDesktopMcpStdio } from "./server.js";

function printHelp(): void {
    const help = `
beeper-desktop-mcp — Beeper Desktop API MCP server (stdio)

Environment:
  BEEPER_DESKTOP_TOKEN   Required. Desktop API token (bdapi_…)
  BEEPER_DESKTOP_URL     Optional. Default http://127.0.0.1:23373
  BEEPER_DESKTOP_MCP_URL Optional. Default $BEEPER_DESKTOP_URL/v0/mcp

Examples:
  BEEPER_DESKTOP_TOKEN=bdapi_… BEEPER_DESKTOP_URL=http://127.0.0.1:23373 beeper-desktop-mcp

  # Claude Desktop / Cursor mcp.json
  {
    "mcpServers": {
      "beeper-desktop": {
        "command": "npx",
        "args": ["-y", "architect-mcp-server", "beeper-desktop"],
        "env": {
          "BEEPER_DESKTOP_TOKEN": "bdapi_…",
          "BEEPER_DESKTOP_URL": "http://127.0.0.1:23373"
        }
      }
    }
  }

Tools:
  beeper_health, list_chats, desktop_tools,
  focus_app, search, get_accounts, get_chat, archive_chat,
  search_chats, set_chat_reminder, clear_chat_reminder,
  list_messages, search_messages, send_message, search_docs,
  desktop_mcp_call
`.trim();
    console.error(help);
}

const arg = process.argv[2];
if (arg === "--help" || arg === "-h" || arg === "help") {
    printHelp();
    process.exit(0);
}

startBeeperDesktopMcpStdio().catch((err) => {
    console.error(
        "beeper-desktop-mcp failed:",
        err instanceof Error ? err.message : err
    );
    process.exit(1);
});
