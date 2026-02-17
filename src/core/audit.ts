import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_LOG_FILE = path.resolve(__dirname, "..", "audit.log");
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024;

export type AuditAction =
    | "tool_created"
    | "tool_updated"
    | "tool_deleted"
    | "tool_activated"
    | "tool_deactivated"
    | "tool_executed"
    | "tool_execution_failed"
    | "permissions_approved"
    | "permissions_revoked"
    | "tool_imported"
    | "tool_exported"
    | "version_saved"
    | "version_rolled_back"
    | "schedule_created"
    | "schedule_deleted"
    | "webhook_created"
    | "webhook_deleted"
    | "pipeline_created"
    | "pipeline_executed"
    | "pipeline_deleted"
    | "secret_set"
    | "secret_deleted"
    | "cache_cleared"
    | "tests_run"
    | "resource_created"
    | "resource_deleted"
    | "prompt_created"
    | "prompt_deleted"
    | "marketplace_exported"
    | "marketplace_imported"
    | "batch_executed"
    | "alias_created"
    | "alias_deleted"
    | "marketplace_published"
    | "marketplace_deleted_remote";

export interface AuditEntry {
    timestamp: string;
    action: AuditAction;
    toolName: string;
    details?: Record<string, any>;
    duration?: number;
}

async function ensureLogFile(): Promise<void> {
    try {
        await fs.access(AUDIT_LOG_FILE);
    } catch {
        await fs.writeFile(AUDIT_LOG_FILE, "");
    }
}

async function rotateLogIfNeeded(): Promise<void> {
    try {
        const stats = await fs.stat(AUDIT_LOG_FILE);
        if (stats.size > MAX_LOG_SIZE_BYTES) {
            const backupPath = AUDIT_LOG_FILE.replace(".log", `.${Date.now()}.log`);
            await fs.rename(AUDIT_LOG_FILE, backupPath);
            await fs.writeFile(AUDIT_LOG_FILE, "");
        }
    } catch {
        // Ignore errors
    }
}

export async function logAudit(
    action: AuditAction,
    toolName: string,
    details?: Record<string, any>,
    duration?: number
): Promise<void> {
    await ensureLogFile();
    await rotateLogIfNeeded();

    const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        action,
        toolName,
        ...(details && { details }),
        ...(duration !== undefined && { duration })
    };

    const line = JSON.stringify(entry) + "\n";
    await fs.appendFile(AUDIT_LOG_FILE, line);
}

export async function getAuditLogs(
    options: {
        toolName?: string;
        action?: AuditAction;
        limit?: number;
        since?: string;
    } = {}
): Promise<AuditEntry[]> {
    await ensureLogFile();

    const content = await fs.readFile(AUDIT_LOG_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    let entries: AuditEntry[] = lines.map(line => {
        try {
            return JSON.parse(line);
        } catch {
            return null;
        }
    }).filter((e): e is AuditEntry => e !== null);

    if (options.toolName) {
        entries = entries.filter(e => e.toolName === options.toolName);
    }

    if (options.action) {
        entries = entries.filter(e => e.action === options.action);
    }

    if (options.since) {
        const sinceDate = new Date(options.since);
        entries = entries.filter(e => new Date(e.timestamp) >= sinceDate);
    }

    entries.reverse();

    if (options.limit) {
        entries = entries.slice(0, options.limit);
    }

    return entries;
}

export async function clearAuditLogs(): Promise<void> {
    await fs.writeFile(AUDIT_LOG_FILE, "");
}

export function formatAuditEntry(entry: AuditEntry): string {
    const time = entry.timestamp.replace("T", " ").replace("Z", "");
    const duration = entry.duration ? ` (${entry.duration}ms)` : "";
    const details = entry.details ? ` ${JSON.stringify(entry.details)}` : "";
    return `[${time}] ${entry.action} - ${entry.toolName}${duration}${details}`;
}
