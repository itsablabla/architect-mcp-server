import { CustomPrompt, PromptArgument } from "../types.js";
import { getDb } from "../core/db.js";

export async function createPrompt(prompt: {
    name: string;
    description: string;
    arguments: PromptArgument[];
    template: string;
}): Promise<CustomPrompt> {
    const db = getDb();
    const now = new Date().toISOString();

    const existing = db.prepare("SELECT created_at FROM prompts WHERE name = ?").get(prompt.name) as any;
    const createdAt = existing?.created_at || now;

    const entry: CustomPrompt = {
        ...prompt,
        createdAt,
        updatedAt: now
    };

    db.prepare(
        `INSERT OR REPLACE INTO prompts (name, description, arguments, template, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(prompt.name, prompt.description, JSON.stringify(prompt.arguments), prompt.template, createdAt, now);

    return entry;
}

export async function getPrompt(name: string): Promise<CustomPrompt | null> {
    const db = getDb();
    const row = db.prepare("SELECT * FROM prompts WHERE name = ?").get(name) as any;
    if (!row) return null;
    return rowToPrompt(row);
}

export async function deletePrompt(name: string): Promise<boolean> {
    const db = getDb();
    const result = db.prepare("DELETE FROM prompts WHERE name = ?").run(name);
    return result.changes > 0;
}

export async function listAllPrompts(): Promise<CustomPrompt[]> {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM prompts").all() as any[];
    return rows.map(rowToPrompt);
}

export function renderPrompt(
    prompt: CustomPrompt,
    args: Record<string, string>
): string {
    let rendered = prompt.template;

    for (const arg of prompt.arguments) {
        const value = args[arg.name];
        if (arg.required && (value === undefined || value === null)) {
            throw new Error(`Missing required argument: ${arg.name}`);
        }
        rendered = rendered.replace(new RegExp(`\\{\\{${arg.name}\\}\\}`, "g"), value || "");
    }

    return rendered;
}

export function formatPrompt(prompt: CustomPrompt): string {
    const args = prompt.arguments
        .map(a => `    ${a.name}${a.required ? " (required)" : ""}: ${a.description}`)
        .join("\n");

    return [
        `${prompt.name}`,
        `  Description: ${prompt.description}`,
        `  Arguments:`,
        args || "    (none)",
        `  Template: ${prompt.template.substring(0, 100)}${prompt.template.length > 100 ? "..." : ""}`
    ].join("\n");
}

function rowToPrompt(row: any): CustomPrompt {
    return {
        name: row.name,
        description: row.description,
        arguments: JSON.parse(row.arguments || "[]"),
        template: row.template,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

export async function loadPrompts() {
    return { version: 1, prompts: {} };
}

export async function savePrompts(_store: any) {
}
