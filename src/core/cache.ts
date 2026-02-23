import * as crypto from "crypto";
import { CacheConfig } from "../types.js";
import { getDb } from "./db.js";

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
    const db = getDb();
    const key = generateCacheKey(toolName, params, config.keyFields);
    const row = db.prepare("SELECT * FROM cache_entries WHERE cache_key = ?").get(key) as any;

    if (!row) {
        db.prepare("UPDATE cache_stats SET misses = misses + 1 WHERE id = 1").run();
        return { hit: false };
    }

    const now = new Date();
    const expiresAt = new Date(row.expires_at);

    if (now > expiresAt) {
        db.prepare("DELETE FROM cache_entries WHERE cache_key = ?").run(key);
        db.prepare("UPDATE cache_stats SET misses = misses + 1 WHERE id = 1").run();
        return { hit: false };
    }

    db.prepare("UPDATE cache_stats SET hits = hits + 1 WHERE id = 1").run();
    return { hit: true, result: JSON.parse(row.result) };
}

export async function setCachedResult(
    toolName: string,
    params: Record<string, unknown>,
    result: any,
    config: CacheConfig
): Promise<void> {
    const db = getDb();
    const key = generateCacheKey(toolName, params, config.keyFields);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.ttlSeconds * 1000);

    db.prepare(
        `INSERT OR REPLACE INTO cache_entries (cache_key, tool_name, result, cached_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(key, toolName, JSON.stringify(result), now.toISOString(), expiresAt.toISOString());
}

export async function clearCacheForTool(toolName: string): Promise<number> {
    const db = getDb();
    const result = db.prepare("DELETE FROM cache_entries WHERE tool_name = ?").run(toolName);
    return result.changes;
}

export async function clearAllCache(): Promise<number> {
    const db = getDb();
    const result = db.prepare("DELETE FROM cache_entries").run();
    return result.changes;
}

export async function cleanExpiredCache(): Promise<number> {
    const db = getDb();
    const result = db.prepare("DELETE FROM cache_entries WHERE expires_at < ?").run(new Date().toISOString());
    return result.changes;
}

export async function getCacheStats(): Promise<{
    totalEntries: number;
    hits: number;
    misses: number;
    hitRate: number;
    entriesByTool: Record<string, number>;
}> {
    const db = getDb();
    const statsRow = db.prepare("SELECT * FROM cache_stats WHERE id = 1").get() as any;
    const hits = statsRow?.hits || 0;
    const misses = statsRow?.misses || 0;

    const entries = db.prepare("SELECT tool_name, COUNT(*) as cnt FROM cache_entries GROUP BY tool_name").all() as any[];
    const entriesByTool: Record<string, number> = {};
    let totalEntries = 0;
    for (const row of entries) {
        entriesByTool[row.tool_name] = row.cnt;
        totalEntries += row.cnt;
    }

    const totalRequests = hits + misses;
    const hitRate = totalRequests > 0 ? (hits / totalRequests) * 100 : 0;

    return {
        totalEntries,
        hits,
        misses,
        hitRate: Math.round(hitRate * 100) / 100,
        entriesByTool
    };
}

export async function flushCache(): Promise<void> {
}

export function startCacheFlushInterval(_ms = 30000): void {
}

export function stopCacheFlushInterval(): void {
}

export async function loadCache(): Promise<any> {
    return {};
}

export async function saveCache(_store: any): Promise<void> {
}
