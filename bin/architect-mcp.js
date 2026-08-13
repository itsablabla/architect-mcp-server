#!/usr/bin/env node

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === "beeper-desktop" || cmd === "beeper-desktop-mcp") {
    process.argv.splice(2, 1);
    await import("../dist/beeper-desktop-mcp/index.js");
} else if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.error(`architect-mcp

Usage:
  architect-mcp                 Start Architect MCP server (stdio)
  architect-mcp beeper-desktop  Start Beeper Desktop API MCP server (stdio)
  architect-mcp help            Show this help

Beeper Desktop env:
  BEEPER_DESKTOP_TOKEN   Required (bdapi_…)
  BEEPER_DESKTOP_URL     Optional (default http://127.0.0.1:23373)
`);
    process.exit(0);
} else {
    await import("../dist/index.js");
}
