import { CustomTool } from "../types.js";
import { getDb } from "../core/db.js";

export async function saveVersion(toolName: string, toolData: CustomTool): Promise<void> {
    const db = getDb();
    db.prepare(
        `INSERT INTO tool_versions (tool_name, version, tool_snapshot, saved_at)
         VALUES (?, ?, ?, ?)`
    ).run(toolName, toolData.version, JSON.stringify(toolData), new Date().toISOString());
}

export async function listVersions(toolName: string): Promise<Array<{
    version: number;
    savedAt: string;
}>> {
    const db = getDb();
    const rows = db.prepare(
        "SELECT version, saved_at FROM tool_versions WHERE tool_name = ? ORDER BY version ASC"
    ).all(toolName) as any[];

    return rows.map(row => ({
        version: row.version,
        savedAt: row.saved_at
    }));
}

export async function getVersion(toolName: string, version: number): Promise<CustomTool | null> {
    const db = getDb();
    const row = db.prepare(
        "SELECT tool_snapshot FROM tool_versions WHERE tool_name = ? AND version = ?"
    ).get(toolName, version) as any;

    if (!row) return null;
    return JSON.parse(row.tool_snapshot);
}

export async function diffVersions(
    toolName: string,
    v1: number,
    v2: number
): Promise<{
    v1: number;
    v2: number;
    changes: Array<{ field: string; from: any; to: any }>;
} | null> {
    const tool1 = await getVersion(toolName, v1);
    const tool2 = await getVersion(toolName, v2);

    if (!tool1 || !tool2) return null;

    const fields = ["description", "code", "schema", "capabilities", "category", "tags"];
    const changes: Array<{ field: string; from: any; to: any }> = [];

    for (const field of fields) {
        const val1 = JSON.stringify((tool1 as any)[field]);
        const val2 = JSON.stringify((tool2 as any)[field]);
        if (val1 !== val2) {
            changes.push({
                field,
                from: (tool1 as any)[field],
                to: (tool2 as any)[field]
            });
        }
    }

    return { v1, v2, changes };
}
