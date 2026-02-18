import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { AgentPersona } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSONAS_FILE = path.resolve(__dirname, "..", "personas.json");

async function loadPersonas(): Promise<Record<string, AgentPersona>> {
    try {
        const content = await fs.readFile(PERSONAS_FILE, "utf-8");
        return JSON.parse(content);
    } catch {
        return {};
    }
}

async function savePersonas(personas: Record<string, AgentPersona>): Promise<void> {
    await fs.writeFile(PERSONAS_FILE, JSON.stringify(personas, null, 2));
}

export async function createPersona(persona: Omit<AgentPersona, "createdAt" | "updatedAt">): Promise<AgentPersona> {
    const personas = await loadPersonas();
    const now = new Date().toISOString();
    const full: AgentPersona = { ...persona, createdAt: now, updatedAt: now };
    personas[persona.name] = full;
    await savePersonas(personas);
    return full;
}

export async function getPersona(name: string): Promise<AgentPersona | null> {
    const personas = await loadPersonas();
    return personas[name] ?? null;
}

export async function updatePersona(name: string, updates: Partial<Omit<AgentPersona, "name" | "createdAt">>): Promise<AgentPersona | null> {
    const personas = await loadPersonas();
    if (!personas[name]) return null;
    personas[name] = { ...personas[name], ...updates, updatedAt: new Date().toISOString() };
    await savePersonas(personas);
    return personas[name];
}

export async function deletePersona(name: string): Promise<boolean> {
    const personas = await loadPersonas();
    if (!personas[name]) return false;
    delete personas[name];
    await savePersonas(personas);
    return true;
}

export async function listPersonas(): Promise<AgentPersona[]> {
    const personas = await loadPersonas();
    return Object.values(personas);
}

export function formatPersona(p: AgentPersona): string {
    const lines = [
        `Persona: ${p.name}`,
        `  Description: ${p.description}`,
        `  Tools (${p.tools.length}): ${p.tools.join(", ") || "(none)"}`,
        `  Created: ${p.createdAt}`,
        `  Updated: ${p.updatedAt}`
    ];
    if (p.systemPrompt) {
        lines.push(`  System Prompt: ${p.systemPrompt.slice(0, 120)}${p.systemPrompt.length > 120 ? "..." : ""}`);
    }
    return lines.join("\n");
}
