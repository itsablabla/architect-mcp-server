#!/usr/bin/env node
/**
 * Smoke test for beeper-desktop-mcp against a live Desktop API.
 *
 * Usage:
 *   BEEPER_DESKTOP_TOKEN=bdapi_… \
 *   BEEPER_DESKTOP_URL=http://127.0.0.1:23373 \
 *   node scripts/smoke-beeper-desktop.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "dist/beeper-desktop-mcp/index.js");

if (!process.env.BEEPER_DESKTOP_TOKEN && !process.env.BEEPER_ACCESS_TOKEN && !process.env.BEEPER_TOKEN) {
    console.error("Missing BEEPER_DESKTOP_TOKEN");
    process.exit(2);
}

const build = spawnSync("npm", ["run", "build"], { cwd: root, encoding: "utf8" });
if (build.status !== 0) {
    console.error(build.stdout || "");
    console.error(build.stderr || "");
    process.exit(build.status || 1);
}

const transport = new StdioClientTransport({
    command: "node",
    args: [entry],
    env: { ...process.env }
});

const client = new Client({ name: "beeper-desktop-smoke", version: "1.0.0" });
await client.connect(transport);

const failures = [];
async function check(name, args = {}) {
    try {
        const res = await client.callTool({ name, arguments: args });
        if (res.isError) {
            failures.push(`${name}: ${JSON.stringify(res)}`);
            console.log("FAIL", name);
            return;
        }
        console.log("PASS", name);
    } catch (err) {
        failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
        console.log("FAIL", name, err instanceof Error ? err.message : err);
    }
}

const listed = await client.listTools();
console.log("tools", listed.tools.length, listed.tools.map((t) => t.name).join(", "));

await check("beeper_health");
await check("get_accounts");
await check("list_chats", { limit: 2 });
await check("desktop_tools");
await check("search_chats", { query: "a", limit: 1 });
await check("send_message", { chatID: "__dry_run__", text: "smoke" });

await client.close();

if (failures.length) {
    console.error("SMOKE_FAIL", failures.length);
    for (const f of failures) console.error(f);
    process.exit(1);
}
console.log("SMOKE_OK");
