import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import { CacheStore, CacheEntry, CacheConfig } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.resolve(__dirname, "..", "cache.json");
const CACHE_SCHEMA_VERSION = 1;

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export async function loadCache(): Promise<CacheStore> {
    if (!await fileExists(CACHE_FILE)) {
        return {
            version: CACHE_SCHEMA_VERSION,
            entries: {},
            stats: { hits: 0, misses: 0 }
        };
    }

    try {
        const content = await fs.readFile(CACHE_FILE, "utf-8");
        const data = JSON.parse(content) as CacheStore;
        return {
            version: data.version || CACHE_SCHEMA_VERSION,
            entries: data.entries || {},
            stats: data.stats || { hits: 0, misses: 0 }
        };
    } catch {
        return {
            version: CACHE_SCHEMA_VERSION,
            entries: {},
            stats: { hits: 0, misses: 0 }
        };
    }
}

export async function saveCache(store: CacheStore): Promise<void> {
    await fs.writeFile(CACHE_FILE, JSON.stringify(store, null, 2));
}

function generateCacheKey(toolName: string, params: Record<string, unknown>, keyFields?: string[]): string {
    let dataToHash: Record<string, unknown>;

    if (keyFields && keyFields.length > 0) {
        dataToHash = {};
        for (const field of keyFields) {
            if (field in params) {
                dataToHash[field] = params[field];
            }
        }
    } else {
        dataToHash = params;
    }

    const hash = crypto.createHash("sha256");
    hash.update(toolName + ":" + JSON.stringify(dataToHash, Object.keys(dataToHash).sort()));
    return hash.digest("hex").substring(0, 32);
}

export async function getCachedResult(
    toolName: string,
    params: Record<string, unknown>,
    config: CacheConfig
): Promise<{ hit: boolean; result?: any }> {
    const store = await loadCache();
    const key = generateCacheKey(toolName, params, config.keyFields);
    const entry = store.entries[key];

    if (!entry) {
        store.stats.misses++;
        await saveCache(store);
        return { hit: false };
    }

    const now = new Date();
    const expiresAt = new Date(entry.expiresAt);

    if (now > expiresAt) {
        delete store.entries[key];
        store.stats.misses++;
        await saveCache(store);
        return { hit: false };
    }

    store.stats.hits++;
    await saveCache(store);
    return { hit: true, result: entry.result };
}

export async function setCachedResult(
    toolName: string,
    params: Record<string, unknown>,
    result: any,
    config: CacheConfig
): Promise<void> {
    const store = await loadCache();
    const key = generateCacheKey(toolName, params, config.keyFields);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.ttlSeconds * 1000);

    store.entries[key] = {
        key,
        result,
        cachedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        toolName
    };

    await saveCache(store);
}

export async function clearCacheForTool(toolName: string): Promise<number> {
    const store = await loadCache();
    let cleared = 0;

    for (const key of Object.keys(store.entries)) {
        if (store.entries[key].toolName === toolName) {
            delete store.entries[key];
            cleared++;
        }
    }

    await saveCache(store);
    return cleared;
}

export async function clearAllCache(): Promise<number> {
    const store = await loadCache();
    const cleared = Object.keys(store.entries).length;

    store.entries = {};
    await saveCache(store);
    return cleared;
}

export async function cleanExpiredCache(): Promise<number> {
    const store = await loadCache();
    const now = new Date();
    let cleaned = 0;

    for (const key of Object.keys(store.entries)) {
        const expiresAt = new Date(store.entries[key].expiresAt);
        if (now > expiresAt) {
            delete store.entries[key];
            cleaned++;
        }
    }

    if (cleaned > 0) {
        await saveCache(store);
    }

    return cleaned;
}

export async function getCacheStats(): Promise<{
    totalEntries: number;
    hits: number;
    misses: number;
    hitRate: number;
    entriesByTool: Record<string, number>;
}> {
    const store = await loadCache();
    const entriesByTool: Record<string, number> = {};

    for (const entry of Object.values(store.entries)) {
        entriesByTool[entry.toolName] = (entriesByTool[entry.toolName] || 0) + 1;
    }

    const totalRequests = store.stats.hits + store.stats.misses;
    const hitRate = totalRequests > 0 ? (store.stats.hits / totalRequests) * 100 : 0;

    return {
        totalEntries: Object.keys(store.entries).length,
        hits: store.stats.hits,
        misses: store.stats.misses,
        hitRate: Math.round(hitRate * 100) / 100,
        entriesByTool
    };
}

export function formatCacheStats(stats: Awaited<ReturnType<typeof getCacheStats>>): string {
    const lines = [
        `Total Cached Entries: ${stats.totalEntries}`,
        `Cache Hits: ${stats.hits}`,
        `Cache Misses: ${stats.misses}`,
        `Hit Rate: ${stats.hitRate}%`,
        "",
        "Entries by Tool:"
    ];

    for (const [tool, count] of Object.entries(stats.entriesByTool)) {
        lines.push(`  ${tool}: ${count}`);
    }

    if (Object.keys(stats.entriesByTool).length === 0) {
        lines.push("  (none)");
    }

    return lines.join("\n");
}
