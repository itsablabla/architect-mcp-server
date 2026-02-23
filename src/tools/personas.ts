import { AgentPersona } from "../types.js";
import { getDb } from "../core/db.js";

export async function createPersona(config: {
    name: string;
    description: string;
    tools: string[];
    systemPrompt?: string;
}): Promise<AgentPersona> {
    const db = getDb();
    const now = new Date().toISOString();

    const persona: AgentPersona = {
        name: config.name,
        description: config.description,
        tools: config.tools,
        systemPrompt: config.systemPrompt,
        createdAt: now,
        updatedAt: now
    };

    db.prepare(
        `INSERT OR REPLACE INTO personas (name, description, tools, system_prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(config.name, config.description, JSON.stringify(config.tools), config.systemPrompt || null, now, now);

    return persona;
}

export async function getPersona(name: string): Promise<AgentPersona | null> {
    const db = getDb();
    const row = db.prepare("SELECT * FROM personas WHERE name = ?").get(name) as any;
    if (!row) return null;
    return rowToPersona(row);
}

export async function updatePersona(
    name: string,
    updates: {
        description?: string;
        tools?: string[];
        systemPrompt?: string;
    }
): Promise<AgentPersona | null> {
    const existing = await getPersona(name);
    if (!existing) return null;

    const db = getDb();
    const now = new Date().toISOString();

    const updated = {
        description: updates.description ?? existing.description,
        tools: updates.tools ?? existing.tools,
        systemPrompt: updates.systemPrompt ?? existing.systemPrompt
    };

    db.prepare(
        `UPDATE personas SET description = ?, tools = ?, system_prompt = ?, updated_at = ?
         WHERE name = ?`
    ).run(updated.description, JSON.stringify(updated.tools), updated.systemPrompt || null, now, name);

    return { ...existing, ...updated, updatedAt: now };
}

export async function deletePersona(name: string): Promise<boolean> {
    const db = getDb();
    const result = db.prepare("DELETE FROM personas WHERE name = ?").run(name);
    return result.changes > 0;
}

export async function listAllPersonas(): Promise<AgentPersona[]> {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM personas").all() as any[];
    return rows.map(rowToPersona);
}

export { listAllPersonas as listPersonas };

export function formatPersona(persona: AgentPersona): string {
    return [
        `${persona.name}`,
        `  Description: ${persona.description}`,
        `  Tools: ${persona.tools.join(", ") || "(none)"}`,
        `  System Prompt: ${persona.systemPrompt ? persona.systemPrompt.substring(0, 100) + (persona.systemPrompt.length > 100 ? "..." : "") : "(none)"}`
    ].join("\n");
}

function rowToPersona(row: any): AgentPersona {
    return {
        name: row.name,
        description: row.description,
        tools: JSON.parse(row.tools || "[]"),
        systemPrompt: row.system_prompt || undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
