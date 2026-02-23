import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { ToolAlias, AliasStore } from "../types.js";
import { fileExists } from "../core/utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALIASES_FILE = path.resolve(__dirname, "..", "aliases.json");
const ALIASES_SCHEMA_VERSION = 1;



export async function loadAliases(): Promise<AliasStore> {
    if (!await fileExists(ALIASES_FILE)) {
        return { version: ALIASES_SCHEMA_VERSION, aliases: {} };
    }

    try {
        const content = await fs.readFile(ALIASES_FILE, "utf-8");
        const data = JSON.parse(content) as AliasStore;
        return {
            version: data.version || ALIASES_SCHEMA_VERSION,
            aliases: data.aliases || {}
        };
    } catch {
        return { version: ALIASES_SCHEMA_VERSION, aliases: {} };
    }
}

export async function saveAliases(store: AliasStore): Promise<void> {
    await fs.writeFile(ALIASES_FILE, JSON.stringify(store, null, 2));
}

export async function createAlias(
    alias: string,
    targetTool: string,
    presetParams: Record<string, unknown>,
    description?: string
): Promise<ToolAlias> {
    const store = await loadAliases();

    const entry: ToolAlias = {
        alias,
        targetTool,
        presetParams,
        description,
        createdAt: new Date().toISOString()
    };

    store.aliases[alias] = entry;
    await saveAliases(store);
    return entry;
}

export async function deleteAlias(alias: string): Promise<boolean> {
    const store = await loadAliases();
    if (!store.aliases[alias]) return false;
    delete store.aliases[alias];
    await saveAliases(store);
    return true;
}

export async function getAlias(alias: string): Promise<ToolAlias | null> {
    const store = await loadAliases();
    return store.aliases[alias] || null;
}

export async function listAllAliases(): Promise<ToolAlias[]> {
    const store = await loadAliases();
    return Object.values(store.aliases);
}

export function resolveAliasParams(
    alias: ToolAlias,
    inputParams: Record<string, unknown>
): Record<string, unknown> {
    return { ...alias.presetParams, ...inputParams };
}
