import { CustomResource } from "../types.js";
import { getDb } from "../core/db.js";

export async function createResource(resource: {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
    content: string;
}): Promise<CustomResource> {
    const db = getDb();
    const now = new Date().toISOString();

    const existing = db.prepare("SELECT created_at FROM resources WHERE uri = ?").get(resource.uri) as any;
    const createdAt = existing?.created_at || now;

    const entry: CustomResource = {
        ...resource,
        createdAt,
        updatedAt: now
    };

    db.prepare(
        `INSERT OR REPLACE INTO resources (uri, name, description, mime_type, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(resource.uri, resource.name, resource.description, resource.mimeType, resource.content, createdAt, now);

    return entry;
}

export async function getResource(uri: string): Promise<CustomResource | null> {
    const db = getDb();
    const row = db.prepare("SELECT * FROM resources WHERE uri = ?").get(uri) as any;
    if (!row) return null;
    return rowToResource(row);
}

export async function deleteResource(uri: string): Promise<boolean> {
    const db = getDb();
    const result = db.prepare("DELETE FROM resources WHERE uri = ?").run(uri);
    return result.changes > 0;
}

export async function listAllResources(): Promise<CustomResource[]> {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM resources").all() as any[];
    return rows.map(rowToResource);
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

function rowToResource(row: any): CustomResource {
    return {
        uri: row.uri,
        name: row.name,
        description: row.description,
        mimeType: row.mime_type,
        content: row.content,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

export async function loadResources() {
    return { version: 1, resources: {} };
}

export async function saveResources(_store: any) {
}
