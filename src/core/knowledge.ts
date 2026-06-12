import * as crypto from "crypto";
import { getDb } from "./db.js";

const DEFAULT_TTL_HOURS = 24;

function hashQuery(query: string): string {
    return crypto.createHash("sha256").update(query.toLowerCase().trim()).digest("hex").substring(0, 32);
}

export async function getCachedKnowledge(query: string): Promise<string | null> {
    const db = getDb();
    const key = hashQuery(query);
    const row = db.prepare("SELECT * FROM knowledge_cache WHERE cache_key = ?").get(key) as any;
    if (!row) return null;
    if (new Date() > new Date(row.expires_at)) {
        db.prepare("DELETE FROM knowledge_cache WHERE cache_key = ?").run(key);
        return null;
    }
    return row.result;
}

export async function setCachedKnowledge(query: string, result: string, ttlHours: number = DEFAULT_TTL_HOURS): Promise<void> {
    const db = getDb();
    const key = hashQuery(query);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
    db.prepare(
        `INSERT OR REPLACE INTO knowledge_cache (cache_key, query, result, cached_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(key, query, result, now.toISOString(), expiresAt.toISOString());
}

export async function clearExpiredKnowledgeCache(): Promise<number> {
    const db = getDb();
    const result = db.prepare("DELETE FROM knowledge_cache WHERE expires_at < ?").run(new Date().toISOString());
    return result.changes;
}

export async function clearAllKnowledgeCache(): Promise<number> {
    const db = getDb();
    const count = (db.prepare("SELECT COUNT(*) as c FROM knowledge_cache").get() as any).c;
    db.prepare("DELETE FROM knowledge_cache").run();
    return count;
}

export async function getKnowledgeCacheStats(): Promise<{ total: number; expired: number; fresh: number }> {
    const db = getDb();
    const now = new Date().toISOString();
    const total = (db.prepare("SELECT COUNT(*) as c FROM knowledge_cache").get() as any).c;
    const expired = (db.prepare("SELECT COUNT(*) as c FROM knowledge_cache WHERE expires_at < ?").get(now) as any).c;
    return { total, expired, fresh: total - expired };
}

export function buildKnowledgePrompt(): string {
    const now = new Date();
    const month = now.toLocaleString("en-US", { month: "long" });
    const year = now.getFullYear();
    return [
        `## ARCHITECT RULES (${month} ${year})`,
        ``,
        `Gateways: tool, find, run, automate, store, share, admin, browser. Call as {action:"<name>", args:{...}}; {action:"help"} lists actions, {action:"help", args:{action:"<name>"}} gives an action's args schema. Activated custom tools are called directly by their own name.`,
        ``,
        `Sandbox: fetch(url) returns {ok,status,body} — body is pre-parsed, never call .text()/.json(). secrets.get("NAME") for credentials — never hardcode keys. callTool("name", params) to chain tools — list them in dependencies[]. fs/exec/env only when the capability is approved. console.log goes to logs, not return values.`,
        ``,
        `Design: build general tools, not task scripts — web_scraper(url) not hackernews_scraper(). verb_noun names, no brands/domains in names. One tool, one responsibility. Params over hardcoding.`,
        ``,
        `Discovery: find {action:"search_tools"} matches name, description, and tags. Write descriptions covering the full capability surface and broad tags (action, protocol, data type, domain), or the tool will never be found and duplicates will be built.`,
        ``,
        `Workflow: search first — never rebuild what exists. tool {action:"create_tool"} activates immediately when no capabilities are requested; otherwise follow with 'approve_tool' then 'save_tool'. Missing credentials never block creation — use secrets.get() and tell the user which secret to set afterward.`,
        ``,
        `Capabilities: request the minimum. net with exact domains, fs with mode+paths, child_process with exact commands, env with exact variable names. Broad requests get rejected. Changing a tool's code or imports invalidates its approval — re-approve after edits.`,
        ``,
        `Maintenance: every tool needs at least one test. On failure, read the error and fix with the 'update_tool' action — never delete and rebuild narrower. Failing >3 days: 'get_mutation_context', then deprecate and replace.`,
    ].join("\n");
}
