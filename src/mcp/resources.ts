import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { CustomResource, ResourceStore } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESOURCES_FILE = path.resolve(__dirname, "..", "resources.json");
const RESOURCES_SCHEMA_VERSION = 1;

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export async function loadResources(): Promise<ResourceStore> {
    if (!await fileExists(RESOURCES_FILE)) {
        return { version: RESOURCES_SCHEMA_VERSION, resources: {} };
    }

    try {
        const content = await fs.readFile(RESOURCES_FILE, "utf-8");
        const data = JSON.parse(content) as ResourceStore;
        return {
            version: data.version || RESOURCES_SCHEMA_VERSION,
            resources: data.resources || {}
        };
    } catch {
        return { version: RESOURCES_SCHEMA_VERSION, resources: {} };
    }
}

export async function saveResources(store: ResourceStore): Promise<void> {
    await fs.writeFile(RESOURCES_FILE, JSON.stringify(store, null, 2));
}

export async function createResource(resource: {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
    content: string;
}): Promise<CustomResource> {
    const store = await loadResources();
    const now = new Date().toISOString();

    const entry: CustomResource = {
        ...resource,
        createdAt: store.resources[resource.uri]?.createdAt || now,
        updatedAt: now
    };

    store.resources[resource.uri] = entry;
    await saveResources(store);
    return entry;
}

export async function getResource(uri: string): Promise<CustomResource | null> {
    const store = await loadResources();
    return store.resources[uri] || null;
}

export async function deleteResource(uri: string): Promise<boolean> {
    const store = await loadResources();
    if (!store.resources[uri]) return false;
    delete store.resources[uri];
    await saveResources(store);
    return true;
}

export async function listAllResources(): Promise<CustomResource[]> {
    const store = await loadResources();
    return Object.values(store.resources);
}

export function formatResource(resource: CustomResource): string {
    return [
        `${resource.name}`,
        `  URI: ${resource.uri}`,
        `  MIME Type: ${resource.mimeType}`,
        `  Description: ${resource.description}`,
        `  Content Length: ${resource.content.length} chars`
    ].join("\n");
}
