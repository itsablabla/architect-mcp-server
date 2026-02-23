import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { CustomPrompt, PromptStore, PromptArgument } from "../types.js";
import { fileExists } from "../core/utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_FILE = path.resolve(__dirname, "..", "prompts.json");
const PROMPTS_SCHEMA_VERSION = 1;



export async function loadPrompts(): Promise<PromptStore> {
    if (!await fileExists(PROMPTS_FILE)) {
        return { version: PROMPTS_SCHEMA_VERSION, prompts: {} };
    }

    try {
        const content = await fs.readFile(PROMPTS_FILE, "utf-8");
        const data = JSON.parse(content) as PromptStore;
        return {
            version: data.version || PROMPTS_SCHEMA_VERSION,
            prompts: data.prompts || {}
        };
    } catch {
        return { version: PROMPTS_SCHEMA_VERSION, prompts: {} };
    }
}

export async function savePrompts(store: PromptStore): Promise<void> {
    await fs.writeFile(PROMPTS_FILE, JSON.stringify(store, null, 2));
}

export async function createPrompt(prompt: {
    name: string;
    description: string;
    arguments: PromptArgument[];
    template: string;
}): Promise<CustomPrompt> {
    const store = await loadPrompts();
    const now = new Date().toISOString();

    const entry: CustomPrompt = {
        ...prompt,
        createdAt: store.prompts[prompt.name]?.createdAt || now,
        updatedAt: now
    };

    store.prompts[prompt.name] = entry;
    await savePrompts(store);
    return entry;
}

export async function getPrompt(name: string): Promise<CustomPrompt | null> {
    const store = await loadPrompts();
    return store.prompts[name] || null;
}

export async function deletePrompt(name: string): Promise<boolean> {
    const store = await loadPrompts();
    if (!store.prompts[name]) return false;
    delete store.prompts[name];
    await savePrompts(store);
    return true;
}

export async function listAllPrompts(): Promise<CustomPrompt[]> {
    const store = await loadPrompts();
    return Object.values(store.prompts);
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
