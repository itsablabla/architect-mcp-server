import { ToolAlias } from "../types.js";
import { getDb } from "../core/db.js";

export async function createAlias(config: {
    alias: string;
    targetTool: string;
    presetParams?: Record<string, unknown>;
    description?: string;
}): Promise<ToolAlias> {
    const db = getDb();
    const now = new Date().toISOString();

    const entry: ToolAlias = {
        alias: config.alias,
        targetTool: config.targetTool,
        presetParams: config.presetParams || {},
        description: config.description,
        createdAt: now
    };

    db.prepare(
        `INSERT OR REPLACE INTO aliases (alias, target_tool, preset_params, description, created_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(entry.alias, entry.targetTool, JSON.stringify(entry.presetParams), entry.description || null, now);

    return entry;
}

export async function deleteAlias(alias: string): Promise<boolean> {
    const db = getDb();
    const result = db.prepare("DELETE FROM aliases WHERE alias = ?").run(alias);
    return result.changes > 0;
}

export async function getAlias(alias: string): Promise<ToolAlias | null> {
    const db = getDb();
    const row = db.prepare("SELECT * FROM aliases WHERE alias = ?").get(alias) as any;
    if (!row) return null;
    return rowToAlias(row);
}

export async function listAllAliases(): Promise<ToolAlias[]> {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM aliases").all() as any[];
    return rows.map(rowToAlias);
}

export async function resolveAlias(
    alias: string,
    params: Record<string, unknown> = {}
): Promise<{ toolName: string; mergedParams: Record<string, unknown> } | null> {
    const config = await getAlias(alias);
    if (!config) return null;

    return {
        toolName: config.targetTool,
        mergedParams: { ...config.presetParams, ...params }
    };
}

export { resolveAlias as resolveAliasParams };

function rowToAlias(row: any): ToolAlias {
    return {
        alias: row.alias,
        targetTool: row.target_tool,
        presetParams: JSON.parse(row.preset_params || "{}"),
        description: row.description || undefined,
        createdAt: row.created_at
    };
}
