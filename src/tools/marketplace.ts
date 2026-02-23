import { MarketplaceEntry, CustomTool, ExportedTool } from "../types.js";
import { getToolStats } from "../core/history.js";
import { getDb } from "../core/db.js";

const REMOTE_CACHE_TTL_MS = 60 * 60 * 1000;

export async function exportToMarketplace(
    tool: CustomTool,
    author: string
): Promise<MarketplaceEntry> {
    const db = getDb();
    const id = `${tool.name}_${Date.now()}`;
    const now = new Date().toISOString();

    const exportedTool: ExportedTool = {
        formatVersion: 1,
        exportedAt: now,
        tool
    };

    const entry: MarketplaceEntry = {
        id,
        name: tool.name,
        description: tool.description,
        author,
        version: `${tool.version}`,
        category: tool.category || "other",
        tags: tool.tags || [],
        exportedTool,
        exportedAt: now
    };

    db.prepare(
        `INSERT OR REPLACE INTO marketplace_local (id, tool_name, description, author, version, category, tags, exported_tool, exported_at, installs, failure_reports, success_rate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 100)`
    ).run(id, tool.name, tool.description, author, `${tool.version}`, tool.category || "other", JSON.stringify(tool.tags || []), JSON.stringify(entry), now);

    return entry;
}

export async function importFromMarketplace(id: string): Promise<ExportedTool | null> {
    const db = getDb();
    const row = db.prepare("SELECT exported_tool FROM marketplace_local WHERE id = ?").get(id) as any;
    if (!row) return null;
    const entry = JSON.parse(row.exported_tool) as MarketplaceEntry;
    return entry.exportedTool;
}

export async function listMarketplace(): Promise<MarketplaceEntry[]> {
    const db = getDb();
    const rows = db.prepare("SELECT exported_tool FROM marketplace_local").all() as any[];
    return rows.map(r => JSON.parse(r.exported_tool) as MarketplaceEntry);
}

export async function deleteFromMarketplace(id: string): Promise<boolean> {
    const db = getDb();
    const result = db.prepare("DELETE FROM marketplace_local WHERE id = ?").run(id);
    return result.changes > 0;
}

export interface MarketplacePeer {
    url: string;
    label?: string;
    addedAt: string;
}

export async function add_marketplace_peer(url: string, label?: string): Promise<void> {
    const db = getDb();
    let cleanUrl = url.trim();
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);
    db.prepare("INSERT OR REPLACE INTO marketplace_peers (url, label, added_at) VALUES (?, ?, ?)")
        .run(cleanUrl, label || null, new Date().toISOString());
}

export async function list_marketplace_peers(): Promise<MarketplacePeer[]> {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM marketplace_peers").all() as any[];
    return rows.map(r => ({
        url: r.url,
        label: r.label,
        addedAt: r.added_at
    }));
}

export function formatMarketplaceEntry(entry: MarketplaceEntry): string {
    const lines = [
        `${entry.name} (v${entry.version}) by ${entry.author}`,
        `  ID: ${entry.id}`,
        `  Category: ${entry.category}`,
        `  Tags: ${entry.tags.join(", ") || "none"}`,
        `  Description: ${entry.description}`,
        `  Exported: ${entry.exportedAt}`
    ];
    if (entry.installs !== undefined) lines.push(`  Installs: ${entry.installs}`);
    if (entry.failureReports !== undefined) lines.push(`  Failure Reports: ${entry.failureReports}`);
    if (entry.successRate !== undefined) lines.push(`  Success Rate: ${entry.successRate}%`);
    if (entry.usageStats) {
        const u = entry.usageStats;
        lines.push(`  Usage: ${u.totalCalls} calls, ${u.successfulCalls} ok, ${u.failedCalls} failed, avg ${u.averageDurationMs}ms`);
    }
    return lines.join("\n");
}

const DEFAULT_REMOTE_REPO = {
    owner: "ageborn-dev",
    repo: "architect-mcp-marketplace"
};

async function githubApi(
    apiPath: string,
    token: string,
    method: string = "GET",
    body?: unknown
): Promise<{ ok: boolean; status: number; data: any }> {
    const url = `https://api.github.com/repos/${DEFAULT_REMOTE_REPO.owner}/${DEFAULT_REMOTE_REPO.repo}/contents/${apiPath}`;
    const headers: Record<string, string> = {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "architect-mcp",
        "X-GitHub-Api-Version": "2022-11-28"
    };
    if (body) headers["Content-Type"] = "application/json";

    const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    let data: any;
    try { data = await response.json(); } catch { data = null; }
    return { ok: response.ok, status: response.status, data };
}

export async function getTokenOwner(token: string): Promise<{ id: number; login: string } | null> {
    const response = await fetch("https://api.github.com/user", {
        headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "architect-mcp"
        }
    });
    if (!response.ok) return null;
    const data = await response.json() as { id: number; login: string };
    return { id: data.id, login: data.login };
}

export async function publishToRemote(
    tool: CustomTool,
    author: string,
    token: string
): Promise<MarketplaceEntry> {
    const owner = await getTokenOwner(token);
    if (!owner) throw new Error("Failed to verify token owner. Check your GitHub token.");

    const filePath = `tools/${tool.name}.json`;
    const existing = await githubApi(filePath, token);

    if (existing.ok) {
        try {
            const decoded = Buffer.from(existing.data.content, "base64").toString("utf-8");
            const existingEntry = JSON.parse(decoded) as MarketplaceEntry;
            if (existingEntry.owner_id && existingEntry.owner_id !== owner.id) {
                throw new Error(`Tool '${tool.name}' is owned by @${existingEntry.owner_login}. Only the original publisher can update it.`);
            }
        } catch (e) {
            if (e instanceof Error && e.message.includes("owned by")) throw e;
        }
    }

    const entry: MarketplaceEntry = {
        id: tool.name,
        name: tool.name,
        description: tool.description,
        author,
        version: `${tool.version}`,
        category: tool.category || "other",
        tags: tool.tags || [],
        exportedTool: { formatVersion: 1, exportedAt: new Date().toISOString(), tool },
        exportedAt: new Date().toISOString(),
        owner_id: owner.id,
        owner_login: owner.login
    };

    const content = Buffer.from(JSON.stringify(entry, null, 2)).toString("base64");
    const sha = existing.ok ? existing.data.sha : undefined;

    const result = await githubApi(filePath, token, "PUT", {
        message: `${sha ? "Update" : "Publish"} tool: ${tool.name} by ${author}`,
        content,
        ...(sha ? { sha } : {})
    });

    if (!result.ok) throw new Error(`Failed to publish: ${result.data?.message || result.status}`);

    invalidateRemoteCache(tool.name);
    return entry;
}

function invalidateRemoteCache(toolName?: string): void {
    const db = getDb();
    if (toolName) {
        db.prepare("DELETE FROM marketplace_remote_cache WHERE tool_name = ?").run(toolName);
    } else {
        db.prepare("DELETE FROM marketplace_remote_cache").run();
    }
}

function getCachedRemoteEntries(query?: string, category?: string): MarketplaceEntry[] | null {
    const db = getDb();
    const now = new Date().toISOString();
    const rows = db.prepare("SELECT entry_json FROM marketplace_remote_cache WHERE expires_at > ?").all(now) as any[];
    if (rows.length === 0) return null;

    let entries: MarketplaceEntry[] = rows.map(r => JSON.parse(r.entry_json));

    if (query) {
        const q = query.toLowerCase();
        entries = entries.filter(e =>
            e.name.toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q) ||
            e.tags.some((t: string) => t.toLowerCase().includes(q))
        );
    }
    if (category) entries = entries.filter(e => e.category === category);
    return entries;
}

async function fetchAndCacheRemote(token: string): Promise<MarketplaceEntry[]> {
    const result = await githubApi("tools", token);
    if (!result.ok) {
        if (result.status === 404) return [];
        throw new Error(`Failed to browse: ${result.data?.message || result.status}`);
    }
    if (!Array.isArray(result.data)) return [];

    const jsonFiles = result.data.filter(
        (f: any) => f.name.endsWith(".json") && f.name !== ".gitkeep"
    );

    const settled = await Promise.all(
        jsonFiles.map(async (file: any) => {
            try {
                const fileResult = await githubApi(file.path, token);
                if (!fileResult.ok) return null;
                const decoded = Buffer.from(fileResult.data.content, "base64").toString("utf-8");
                return JSON.parse(decoded) as MarketplaceEntry;
            } catch { return null; }
        })
    );

    const entries = settled.filter((e): e is MarketplaceEntry => e !== null);

    const db = getDb();
    const now = new Date();
    const expires = new Date(now.getTime() + REMOTE_CACHE_TTL_MS).toISOString();
    const nowStr = now.toISOString();

    const upsert = db.prepare(
        `INSERT OR REPLACE INTO marketplace_remote_cache (tool_name, entry_json, cached_at, expires_at)
         VALUES (?, ?, ?, ?)`
    );
    const insertMany = db.transaction((items: MarketplaceEntry[]) => {
        for (const entry of items) {
            upsert.run(entry.name, JSON.stringify(entry), nowStr, expires);
        }
    });
    insertMany(entries);

    return entries;
}

export async function browseRemote(
    token: string,
    query?: string,
    category?: string
): Promise<MarketplaceEntry[]> {
    let githubEntries: MarketplaceEntry[] = [];
    try {
        const cached = getCachedRemoteEntries();
        if (cached !== null) {
            githubEntries = cached;
        } else {
            githubEntries = await fetchAndCacheRemote(token);
        }
    } catch { }

    const peers = await list_marketplace_peers();
    const peerPromises = peers.map(async (peer) => {
        try {
            const url = `${peer.url}/api/marketplace`;
            const res = await fetch(url);
            if (!res.ok) return [];
            return await res.json() as MarketplaceEntry[];
        } catch { return []; }
    });

    const peerResults = await Promise.all(peerPromises);
    const allEntries = [...githubEntries, ...peerResults.flat()];

    const unique = new Map<string, MarketplaceEntry>();
    for (const e of allEntries) {
        if (!unique.has(e.id)) unique.set(e.id, e);
    }

    let filtered = Array.from(unique.values());

    if (query) {
        const q = query.toLowerCase();
        filtered = filtered.filter(e =>
            e.name.toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q) ||
            e.tags.some((t: string) => t.toLowerCase().includes(q))
        );
    }
    if (category) filtered = filtered.filter(e => e.category === category);
    return filtered;
}

export async function installFromRemote(
    id: string,
    token: string
): Promise<ExportedTool | null> {
    const result = await githubApi(`tools/${id}.json`, token);
    if (!result.ok) {
        if (result.status === 404) return null;
        throw new Error(`Failed to fetch: ${result.data?.message || result.status}`);
    }

    try {
        const decoded = Buffer.from(result.data.content, "base64").toString("utf-8");
        const entry = JSON.parse(decoded) as MarketplaceEntry;

        const updated: MarketplaceEntry = { ...entry, installs: (entry.installs ?? 0) + 1 };
        await githubApi(`tools/${id}.json`, token, "PUT", {
            message: `Increment installs: ${id}`,
            content: Buffer.from(JSON.stringify(updated, null, 2)).toString("base64"),
            sha: result.data.sha
        });

        return entry.exportedTool;
    } catch { return null; }
}

export async function deleteFromRemote(
    id: string,
    token: string
): Promise<{ deleted: boolean; error?: string }> {
    const owner = await getTokenOwner(token);
    if (!owner) return { deleted: false, error: "Failed to verify token owner. Check your GitHub token." };

    const existing = await githubApi(`tools/${id}.json`, token);
    if (!existing.ok) return { deleted: false, error: "Tool not found." };

    try {
        const decoded = Buffer.from(existing.data.content, "base64").toString("utf-8");
        const entry = JSON.parse(decoded) as MarketplaceEntry;
        if (entry.owner_id && entry.owner_id !== owner.id) {
            return { deleted: false, error: `Tool '${id}' is owned by @${entry.owner_login}. Only the original publisher can delete it.` };
        }
    } catch { }

    const result = await githubApi(`tools/${id}.json`, token, "DELETE", {
        message: `Remove tool: ${id}`,
        sha: existing.data.sha
    });

    if (result.ok) invalidateRemoteCache(id);
    return { deleted: result.ok };
}

export async function reportToolIssue(
    id: string,
    token: string
): Promise<{ ok: boolean; failureReports: number; successRate: number }> {
    const result = await githubApi(`tools/${id}.json`, token);
    if (!result.ok) throw new Error(`Tool '${id}' not found in marketplace.`);

    const decoded = Buffer.from(result.data.content, "base64").toString("utf-8");
    const entry = JSON.parse(decoded) as MarketplaceEntry;

    const installs = entry.installs ?? 0;
    const failureReports = (entry.failureReports ?? 0) + 1;
    const successRate = installs > 0 ? Math.max(0, Math.round(((installs - failureReports) / installs) * 100)) : 0;

    const updated: MarketplaceEntry = { ...entry, failureReports, successRate };
    await githubApi(`tools/${id}.json`, token, "PUT", {
        message: `Report issue: ${id}`,
        content: Buffer.from(JSON.stringify(updated, null, 2)).toString("base64"),
        sha: result.data.sha
    });

    invalidateRemoteCache(id);
    return { ok: true, failureReports, successRate };
}

export async function publishToolStats(
    id: string,
    toolName: string,
    token: string
): Promise<{ ok: boolean; message: string }> {
    const stats = await getToolStats(toolName);
    if (!stats) return { ok: false, message: `No local stats found for tool '${toolName}'.` };

    const result = await githubApi(`tools/${id}.json`, token);
    if (!result.ok) throw new Error(`Tool '${id}' not found in marketplace.`);

    const decoded = Buffer.from(result.data.content, "base64").toString("utf-8");
    const entry = JSON.parse(decoded) as MarketplaceEntry;

    const updated: MarketplaceEntry = {
        ...entry,
        usageStats: {
            totalCalls: stats.totalCalls,
            successfulCalls: stats.successfulCalls,
            failedCalls: stats.failedCalls,
            averageDurationMs: stats.averageDurationMs,
            lastPublishedAt: new Date().toISOString()
        }
    };

    await githubApi(`tools/${id}.json`, token, "PUT", {
        message: `Publish usage stats: ${id}`,
        content: Buffer.from(JSON.stringify(updated, null, 2)).toString("base64"),
        sha: result.data.sha
    });

    return {
        ok: true,
        message: `Stats published for '${toolName}': ${stats.totalCalls} calls, ${stats.successfulCalls} ok, avg ${stats.averageDurationMs}ms`
    };
}


