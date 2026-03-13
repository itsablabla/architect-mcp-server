import { getDb } from "./db.js";

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
    | "marketplace_deleted"
    | "batch_executed"
    | "alias_created"
    | "alias_deleted"
    | "marketplace_published"
    | "marketplace_deleted_remote"
    | "tool_deprecated"
    | "tool_undeprecated";

export interface AuditEntry {
    timestamp: string;
    action: AuditAction;
    toolName: string;
    details?: Record<string, any>;
    duration?: number;
}

export async function logAudit(
    action: AuditAction,
    toolName: string,
    details?: Record<string, any>,
    duration?: number
): Promise<void> {
    const db = getDb();
    db.prepare(
        `INSERT INTO audit_log (timestamp, action, tool_name, details, duration_ms)
         VALUES (?, ?, ?, ?, ?)`
    ).run(
        new Date().toISOString(),
        action,
        toolName,
        details ? JSON.stringify(details) : null,
        duration ?? null
    );
}

export async function getAuditLogs(
    options: {
        toolName?: string;
        action?: AuditAction;
        limit?: number;
        offset?: number;
        since?: string;
    } = {}
): Promise<AuditEntry[]> {
    const db = getDb();
    let sql = "SELECT * FROM audit_log WHERE 1=1";
    const params: any[] = [];

    if (options.toolName) {
        sql += " AND tool_name = ?";
        params.push(options.toolName);
    }

    if (options.action) {
        sql += " AND action = ?";
        params.push(options.action);
    }

    if (options.since) {
        sql += " AND timestamp >= ?";
        params.push(options.since);
    }

    sql += " ORDER BY id DESC";

    if (options.limit) {
        sql += " LIMIT ?";
        params.push(options.limit);
    }

    if (options.offset) {
        sql += " OFFSET ?";
        params.push(options.offset);
    }

    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map(row => ({
        timestamp: row.timestamp,
        action: row.action as AuditAction,
        toolName: row.tool_name,
        details: row.details ? JSON.parse(row.details) : undefined,
        duration: row.duration_ms ?? undefined
    }));
}

export async function clearAuditLogs(): Promise<void> {
    const db = getDb();
    db.prepare("DELETE FROM audit_log").run();
}

export function formatAuditEntry(entry: AuditEntry): string {
    const time = entry.timestamp.replace("T", " ").replace("Z", "");
    const duration = entry.duration ? ` (${entry.duration}ms)` : "";
    const details = entry.details ? ` ${JSON.stringify(entry.details)}` : "";
    return `[${time}] ${entry.action} - ${entry.toolName}${duration}${details}`;
}
