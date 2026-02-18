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
    return `Current date: ${month} ${year}\n\nYour training data has a cutoff. Before writing any code for this tool:\nSearch and verify that everything you are about to use is current and not deprecated.\nUse your search capability now before proceeding.`;
}
