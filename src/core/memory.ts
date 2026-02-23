import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { MemoryEntry, MemoryStore } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE = path.resolve(__dirname, "..", "memory.json");
const MEMORY_SCHEMA_VERSION = 1;

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function loadMemory(): Promise<MemoryStore> {
    if (!await fileExists(MEMORY_FILE)) {
        return { version: MEMORY_SCHEMA_VERSION, entries: {} };
    }
    try {
        const content = await fs.readFile(MEMORY_FILE, "utf-8");
        const data = JSON.parse(content) as MemoryStore;
        return {
            version: data.version || MEMORY_SCHEMA_VERSION,
            entries: data.entries || {}
        };
    } catch {
        return { version: MEMORY_SCHEMA_VERSION, entries: {} };
    }
}

async function saveMemory(store: MemoryStore): Promise<void> {
    await fs.writeFile(MEMORY_FILE, JSON.stringify(store, null, 2));
}

function makeKey(namespace: string, key: string): string {
    return `${namespace}::${key}`;
}

export async function setMemory(
    key: string,
    value: string,
    namespace: string = "default",
    ttlSeconds?: number
): Promise<void> {
    const store = await loadMemory();
    const now = new Date().toISOString();
    const expiresAt = ttlSeconds
        ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
        : undefined;

    store.entries[makeKey(namespace, key)] = {
        key,
        namespace,
        value,
        createdAt: store.entries[makeKey(namespace, key)]?.createdAt || now,
        updatedAt: now,
        expiresAt
    };

    await saveMemory(store);
}

export async function getMemory(key: string, namespace: string = "default"): Promise<string | null> {
    const store = await loadMemory();
    const entry = store.entries[makeKey(namespace, key)];
    if (!entry) return null;

    if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
        delete store.entries[makeKey(namespace, key)];
        await saveMemory(store);
        return null;
    }

    return entry.value;
}

export async function deleteMemory(key: string, namespace: string = "default"): Promise<boolean> {
    const store = await loadMemory();
    const storeKey = makeKey(namespace, key);
    if (!store.entries[storeKey]) return false;
    delete store.entries[storeKey];
    await saveMemory(store);
    return true;
}

export async function listMemory(namespace?: string): Promise<MemoryEntry[]> {
    const store = await loadMemory();
    const now = new Date();
    const expired: string[] = [];
    const results: MemoryEntry[] = [];

    for (const [storeKey, entry] of Object.entries(store.entries)) {
        if (entry.expiresAt && new Date(entry.expiresAt) < now) {
            expired.push(storeKey);
            continue;
        }
        if (namespace && entry.namespace !== namespace) continue;
        results.push(entry);
    }

    if (expired.length > 0) {
        for (const k of expired) delete store.entries[k];
        await saveMemory(store);
    }

    return results;
}

export async function clearMemory(namespace?: string): Promise<number> {
    const store = await loadMemory();
    let count = 0;

    if (!namespace) {
        count = Object.keys(store.entries).length;
        store.entries = {};
    } else {
        for (const [storeKey, entry] of Object.entries(store.entries)) {
            if (entry.namespace === namespace) {
                delete store.entries[storeKey];
                count++;
            }
        }
    }

    await saveMemory(store);
    return count;
}

export async function cleanExpiredMemory(): Promise<number> {
    const store = await loadMemory();
    const now = new Date();
    let count = 0;

    for (const [storeKey, entry] of Object.entries(store.entries)) {
        if (entry.expiresAt && new Date(entry.expiresAt) < now) {
            delete store.entries[storeKey];
            count++;
        }
    }

    if (count > 0) await saveMemory(store);
    return count;
}
