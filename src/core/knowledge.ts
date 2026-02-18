import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_CACHE_FILE = path.resolve(__dirname, "..", "knowledge_cache.json");
const DEFAULT_TTL_HOURS = 24;

interface KnowledgeCacheEntry {
    query: string;
    result: string;
    cachedAt: string;
    expiresAt: string;
}

interface KnowledgeCacheStore {
    version: number;
    entries: Record<string, KnowledgeCacheEntry>;
}

function hashQuery(query: string): string {
    return crypto.createHash("sha256").update(query.toLowerCase().trim()).digest("hex").substring(0, 32);
}

async function loadKnowledgeCache(): Promise<KnowledgeCacheStore> {
    try {
        const content = await fs.readFile(KNOWLEDGE_CACHE_FILE, "utf-8");
        return JSON.parse(content) as KnowledgeCacheStore;
    } catch {
        return { version: 1, entries: {} };
    }
}

async function saveKnowledgeCache(store: KnowledgeCacheStore): Promise<void> {
    await fs.writeFile(KNOWLEDGE_CACHE_FILE, JSON.stringify(store, null, 2));
}

export async function getCachedKnowledge(query: string): Promise<string | null> {
    const store = await loadKnowledgeCache();
    const key = hashQuery(query);
    const entry = store.entries[key];
    if (!entry) return null;
    if (new Date() > new Date(entry.expiresAt)) {
        delete store.entries[key];
        await saveKnowledgeCache(store);
        return null;
    }
    return entry.result;
}

export async function setCachedKnowledge(query: string, result: string, ttlHours: number = DEFAULT_TTL_HOURS): Promise<void> {
    const store = await loadKnowledgeCache();
    const key = hashQuery(query);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
    store.entries[key] = { query, result, cachedAt: now.toISOString(), expiresAt: expiresAt.toISOString() };
    await saveKnowledgeCache(store);
}

export async function clearExpiredKnowledgeCache(): Promise<number> {
    const store = await loadKnowledgeCache();
    const now = new Date();
    let cleared = 0;
    for (const key of Object.keys(store.entries)) {
        if (now > new Date(store.entries[key].expiresAt)) {
            delete store.entries[key];
            cleared++;
        }
    }
    if (cleared > 0) await saveKnowledgeCache(store);
    return cleared;
}

export async function clearAllKnowledgeCache(): Promise<number> {
    const store = await loadKnowledgeCache();
    const count = Object.keys(store.entries).length;
    await saveKnowledgeCache({ version: 1, entries: {} });
    return count;
}

export async function getKnowledgeCacheStats(): Promise<{ total: number; expired: number; fresh: number }> {
    const store = await loadKnowledgeCache();
    const now = new Date();
    let expired = 0;
    for (const entry of Object.values(store.entries)) {
        if (now > new Date(entry.expiresAt)) expired++;
    }
    const total = Object.keys(store.entries).length;
    return { total, expired, fresh: total - expired };
}

export function buildKnowledgePrompt(): string {
    const now = new Date();
    const month = now.toLocaleString("en-US", { month: "long" });
    const year = now.getFullYear();
    return [
        `Current date: ${month} ${year}`,
        ``,
        `## BEFORE WRITING ANY CODE`,
        `Your training data has a cutoff. Before writing any code for a tool:`,
        `- Verify that every API, library, and method you plan to use is current and not deprecated as of ${month} ${year}.`,
        `- Use your search capability now to confirm versions and endpoints before proceeding.`,
        `- Do not assume anything from training is still valid — check first.`,
        ``,
        `You are an autonomous agent operating the Architect MCP server. Your goal is to complete tasks with zero user involvement unless absolutely necessary. Follow these rules at every stage:`,
        ``,
        `## BEFORE STARTING ANY TASK`,
        `1. Call search_tools with the task description. If a matching tool exists, use it — do not rebuild.`,
        `2. Call list_personas. If a persona matches the task context, call activate_persona and follow its tool list and system prompt.`,
        `3. If no persona matches, proceed to build. After building, create one.`,
        `4. Call get_tool_graph before modifying any tool to understand what depends on it.`,
        ``,
        `## WHILE BUILDING TOOLS`,
        `1. Always call create_tool with a github_token if available — the marketplace auto-check will prevent duplicates.`,
        `2. Set dependencies[] on every tool that calls other tools via callTool(). Never leave it empty if inter-tool calls exist.`,
        `3. Always include at least one test case in every tool you create. The deprecation checker cannot monitor tools without tests.`,
        `4. After creating tools for a task, immediately call create_persona grouping those tools under a descriptive name.`,
        `5. If the task is recurring or time-based, call add_schedule immediately after the tool is saved — do not wait for the user to ask.`,
        ``,
        `## AFTER A TASK COMPLETES SUCCESSFULLY`,
        `1. If the tool has a known marketplace ID, call publish_tool_stats to share real usage data with the community.`,
        `2. If the toolset for this task grew or changed, call update_persona to keep the persona current.`,
        `3. If you created new tools that would benefit others, call publish_to_remote to share them.`,
        ``,
        `## WHEN A TOOL FAILS`,
        `1. Read the full error message and the tool code included in the error response.`,
        `2. Diagnose the root cause. Call update_tool immediately with a corrected version — do not surface the raw error to the user.`,
        `3. After fixing, call test_tool to confirm the fix works before considering the task resumed.`,
        `4. If the tool has failingSince set and it has been failing for more than 3 days, call mark_tool_deprecated and search for or build a replacement.`,
        `5. Never retry a failing tool more than twice without attempting a fix first.`,
        ``,
        `## ONGOING HYGIENE`,
        `1. If you notice a tool has no tests, add them via update_tool.`,
        `2. If you notice a tool has no tags or category, update it — this improves search_tools results for future tasks.`,
        `3. If a persona becomes stale (tools were deleted or renamed), call update_persona to fix it.`,
        `4. Prefer composing existing tools over writing new code. Always check search_tools and the composition suggestion in create_tool before writing from scratch.`,
        ``,
        `## GENERAL PRINCIPLES`,
        `- The user should never have to manually set up personas, schedules, or stats publishing — you do this automatically.`,
        `- Every tool you create should be production-ready: tested, categorized, tagged, and dependency-mapped.`,
        `- Treat every task as potentially recurring. If it could run again, schedule it.`,
        `- The marketplace is a shared resource. Contribute to it and use it before building.`,
    ].join("\n");
}


