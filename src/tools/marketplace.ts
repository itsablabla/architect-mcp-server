import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { MarketplaceEntry, CustomTool, ExportedTool } from "../types.js";
import { getToolStats } from "../core/history.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MARKETPLACE_DIR = path.resolve(__dirname, "..", "marketplace");

async function ensureMarketplaceDir(): Promise<void> {
    try {
        await fs.access(MARKETPLACE_DIR);
    } catch {
        await fs.mkdir(MARKETPLACE_DIR, { recursive: true });
    }
}

export async function exportToMarketplace(
    tool: CustomTool,
    author: string
): Promise<MarketplaceEntry> {
    await ensureMarketplaceDir();

    const id = `${tool.name}_${Date.now()}`;
    const entry: MarketplaceEntry = {
        id,
        name: tool.name,
        description: tool.description,
        author,
        version: `${tool.version}`,
        category: tool.category || "other",
        tags: tool.tags || [],
        exportedTool: {
            formatVersion: 1,
            exportedAt: new Date().toISOString(),
            tool
        },
        exportedAt: new Date().toISOString()
    };

    const filePath = path.join(MARKETPLACE_DIR, `${id}.json`);
    await fs.writeFile(filePath, JSON.stringify(entry, null, 2));
    return entry;
}

export async function importFromMarketplace(id: string): Promise<ExportedTool | null> {
    await ensureMarketplaceDir();
    const filePath = path.join(MARKETPLACE_DIR, `${id}.json`);

    try {
        const content = await fs.readFile(filePath, "utf-8");
        const entry = JSON.parse(content) as MarketplaceEntry;
        return entry.exportedTool;
    } catch {
        return null;
    }
}

export async function listMarketplace(): Promise<MarketplaceEntry[]> {
    await ensureMarketplaceDir();

    const files = await fs.readdir(MARKETPLACE_DIR);
    const entries: MarketplaceEntry[] = [];

    for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
            const content = await fs.readFile(path.join(MARKETPLACE_DIR, file), "utf-8");
            entries.push(JSON.parse(content) as MarketplaceEntry);
        } catch {
        }
    }

    return entries;
}

export async function deleteFromMarketplace(id: string): Promise<boolean> {
    await ensureMarketplaceDir();
    const filePath = path.join(MARKETPLACE_DIR, `${id}.json`);
    try {
        await fs.unlink(filePath);
        return true;
    } catch {
        return false;
    }
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
    if (entry.installs !== undefined) {
        lines.push(`  Installs: ${entry.installs}`);
    }
    if (entry.failureReports !== undefined) {
        lines.push(`  Failure Reports: ${entry.failureReports}`);
    }
    if (entry.successRate !== undefined) {
        lines.push(`  Success Rate: ${entry.successRate}%`);
    }
    if (entry.usageStats) {
        const u = entry.usageStats;
        lines.push(`  Usage: ${u.totalCalls} calls, ${u.successfulCalls} ok, ${u.failedCalls} failed, avg ${u.averageDurationMs}ms`);
    }
    return lines.join("\n");
}

export interface RemoteRepoConfig {
    owner: string;
    repo: string;
    token: string;
}

const DEFAULT_REMOTE_REPO = {
    owner: "ageborn-dev",
    repo: "architect-mcp-marketplace"
};

async function githubApi(
    path: string,
    token: string,
    method: string = "GET",
    body?: unknown
): Promise<{ ok: boolean; status: number; data: any }> {
    const url = `https://api.github.com/repos/${DEFAULT_REMOTE_REPO.owner}/${DEFAULT_REMOTE_REPO.repo}/contents/${path}`;
    const headers: Record<string, string> = {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "architect-mcp",
        "X-GitHub-Api-Version": "2022-11-28"
    };

    if (body) {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    let data: any;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

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
    if (!owner) {
        throw new Error("Failed to verify token owner. Check your GitHub token.");
    }

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
        exportedTool: {
            formatVersion: 1,
            exportedAt: new Date().toISOString(),
            tool
        },
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

    if (!result.ok) {
        throw new Error(`Failed to publish: ${result.data?.message || result.status}`);
    }

    return entry;
}

export async function browseRemote(
    token: string,
    query?: string,
    category?: string
): Promise<MarketplaceEntry[]> {
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
                const entry = JSON.parse(decoded) as MarketplaceEntry;

                if (query) {
                    const q = query.toLowerCase();
                    const matches = entry.name.toLowerCase().includes(q) ||
                        entry.description.toLowerCase().includes(q) ||
                        entry.tags.some((t: string) => t.toLowerCase().includes(q));
                    if (!matches) return null;
                }

                if (category && entry.category !== category) return null;

                return entry;
            } catch {
                return null;
            }
        })
    );

    return settled.filter((e): e is MarketplaceEntry => e !== null);
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
    } catch {
        return null;
    }
}

export async function deleteFromRemote(
    id: string,
    token: string
): Promise<{ deleted: boolean; error?: string }> {
    const owner = await getTokenOwner(token);
    if (!owner) {
        return { deleted: false, error: "Failed to verify token owner. Check your GitHub token." };
    }

    const existing = await githubApi(`tools/${id}.json`, token);
    if (!existing.ok) return { deleted: false, error: "Tool not found." };

    try {
        const decoded = Buffer.from(existing.data.content, "base64").toString("utf-8");
        const entry = JSON.parse(decoded) as MarketplaceEntry;
        if (entry.owner_id && entry.owner_id !== owner.id) {
            return { deleted: false, error: `Tool '${id}' is owned by @${entry.owner_login}. Only the original publisher can delete it.` };
        }
    } catch {
    }

    const result = await githubApi(`tools/${id}.json`, token, "DELETE", {
        message: `Remove tool: ${id}`,
        sha: existing.data.sha
    });

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

    return { ok: true, failureReports, successRate };
}

export async function publishToolStats(
    id: string,
    toolName: string,
    token: string
): Promise<{ ok: boolean; message: string }> {
    const stats = await getToolStats(toolName);
    if (!stats) {
        return { ok: false, message: `No local stats found for tool '${toolName}'.` };
    }

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
