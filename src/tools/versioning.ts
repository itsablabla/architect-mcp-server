import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { CustomTool, ToolVersion, VersionStore } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSIONS_DIR = path.resolve(__dirname, "..", "data", "versions");

async function ensureVersionsDir(): Promise<void> {
    try {
        await fs.access(VERSIONS_DIR);
    } catch {
        await fs.mkdir(VERSIONS_DIR, { recursive: true });
    }
}

function getVersionFilePath(toolName: string): string {
    return path.join(VERSIONS_DIR, `${toolName}.json`);
}

async function loadVersionStore(toolName: string): Promise<VersionStore> {
    await ensureVersionsDir();
    const filePath = getVersionFilePath(toolName);

    try {
        const content = await fs.readFile(filePath, "utf-8");
        return JSON.parse(content) as VersionStore;
    } catch {
        return { toolName, versions: [] };
    }
}

async function saveVersionStore(store: VersionStore): Promise<void> {
    await ensureVersionsDir();
    const filePath = getVersionFilePath(store.toolName);
    await fs.writeFile(filePath, JSON.stringify(store, null, 2));
}

export async function saveVersion(toolName: string, tool: CustomTool): Promise<void> {
    const store = await loadVersionStore(toolName);

    const version: ToolVersion = {
        version: tool.version,
        tool: { ...tool },
        savedAt: new Date().toISOString()
    };

    store.versions.push(version);

    if (store.versions.length > 50) {
        store.versions = store.versions.slice(-50);
    }

    await saveVersionStore(store);
}

export async function listVersions(toolName: string): Promise<ToolVersion[]> {
    const store = await loadVersionStore(toolName);
    return store.versions;
}

export async function getVersion(toolName: string, version: number): Promise<CustomTool | null> {
    const store = await loadVersionStore(toolName);
    const found = store.versions.find(v => v.version === version);
    return found ? found.tool : null;
}

export async function diffVersions(
    toolName: string,
    v1: number,
    v2: number
): Promise<{ field: string; v1Value: any; v2Value: any }[]> {
    const store = await loadVersionStore(toolName);
    const ver1 = store.versions.find(v => v.version === v1);
    const ver2 = store.versions.find(v => v.version === v2);

    if (!ver1 || !ver2) {
        throw new Error(`Version ${!ver1 ? v1 : v2} not found for tool '${toolName}'`);
    }

    const diffs: { field: string; v1Value: any; v2Value: any }[] = [];
    const fieldsToCompare: (keyof CustomTool)[] = [
        "description", "code", "schema", "capabilities", "category", "tags", "dependencies"
    ];

    for (const field of fieldsToCompare) {
        const val1 = JSON.stringify(ver1.tool[field]);
        const val2 = JSON.stringify(ver2.tool[field]);
        if (val1 !== val2) {
            diffs.push({ field, v1Value: ver1.tool[field], v2Value: ver2.tool[field] });
        }
    }

    return diffs;
}

export async function deleteVersionHistory(toolName: string): Promise<void> {
    await ensureVersionsDir();
    const filePath = getVersionFilePath(toolName);
    try {
        await fs.unlink(filePath);
    } catch {
    }
}
