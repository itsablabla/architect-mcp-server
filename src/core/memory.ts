import { MemoryEntry } from "../types.js";
import { getDb } from "./db.js";

function makeKey(namespace: string, key: string): string {
    return `${namespace}::${key}`;
}

export async function setMemory(
    key: string,
    value: string,
    namespace: string = "default",
    ttlSeconds?: number
): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    const expiresAt = ttlSeconds
        ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
        : null;
    const storeKey = makeKey(namespace, key);

    const existing = db.prepare("SELECT created_at FROM memory WHERE store_key = ?").get(storeKey) as any;
    const createdAt = existing?.created_at || now;

    db.prepare(
        `INSERT OR REPLACE INTO memory (store_key, namespace, key, value, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(storeKey, namespace, key, value, createdAt, now, expiresAt);
}

export async function getMemory(key: string, namespace: string = "default"): Promise<string | null> {
    const db = getDb();
    const storeKey = makeKey(namespace, key);
    const row = db.prepare("SELECT * FROM memory WHERE store_key = ?").get(storeKey) as any;
    if (!row) return null;

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
        db.prepare("DELETE FROM memory WHERE store_key = ?").run(storeKey);
        return null;
    }

    return row.value;
}

export async function deleteMemory(key: string, namespace: string = "default"): Promise<boolean> {
    const db = getDb();
    const storeKey = makeKey(namespace, key);
    const result = db.prepare("DELETE FROM memory WHERE store_key = ?").run(storeKey);
    return result.changes > 0;
}

export async function listMemory(namespace?: string): Promise<MemoryEntry[]> {
    const db = getDb();
    const now = new Date();

    db.prepare("DELETE FROM memory WHERE expires_at IS NOT NULL AND expires_at < ?").run(now.toISOString());

    let rows: any[];
    if (namespace) {
        rows = db.prepare("SELECT * FROM memory WHERE namespace = ?").all(namespace) as any[];
    } else {
        rows = db.prepare("SELECT * FROM memory").all() as any[];
    }

    return rows.map(row => ({
        key: row.key,
        namespace: row.namespace,
        value: row.value,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at || undefined
    }));
}

export async function clearMemory(namespace?: string): Promise<number> {
    const db = getDb();
    let result;
    if (!namespace) {
        result = db.prepare("DELETE FROM memory").run();
    } else {
        result = db.prepare("DELETE FROM memory WHERE namespace = ?").run(namespace);
    }
    return result.changes;
}
