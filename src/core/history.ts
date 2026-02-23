import {
    ExecutionStats,
    RateLimitConfig
} from "../types.js";
import { getDb } from "./db.js";

export async function getToolStats(toolName: string): Promise<ExecutionStats | null> {
    const db = getDb();
    const row = db.prepare("SELECT * FROM execution_stats WHERE tool_name = ?").get(toolName) as any;
    if (!row) return null;
    return {
        totalCalls: row.total_calls,
        successfulCalls: row.successful_calls,
        failedCalls: row.failed_calls,
        totalDurationMs: row.total_duration_ms,
        averageDurationMs: row.average_duration_ms,
        lastExecutedAt: row.last_executed_at || undefined
    };
}

export async function recordExecution(
    toolName: string,
    success: boolean,
    durationMs: number
): Promise<void> {
    const db = getDb();
    const existing = db.prepare("SELECT * FROM execution_stats WHERE tool_name = ?").get(toolName) as any;

    if (!existing) {
        const avgMs = Math.round(durationMs);
        db.prepare(
            `INSERT INTO execution_stats (tool_name, total_calls, successful_calls, failed_calls, total_duration_ms, average_duration_ms, last_executed_at)
             VALUES (?, 1, ?, ?, ?, ?, ?)`
        ).run(toolName, success ? 1 : 0, success ? 0 : 1, durationMs, avgMs, new Date().toISOString());
    } else {
        const totalCalls = existing.total_calls + 1;
        const totalDuration = existing.total_duration_ms + durationMs;
        const avgMs = Math.round(totalDuration / totalCalls);
        db.prepare(
            `UPDATE execution_stats
             SET total_calls = ?, successful_calls = ?, failed_calls = ?,
                 total_duration_ms = ?, average_duration_ms = ?, last_executed_at = ?
             WHERE tool_name = ?`
        ).run(
            totalCalls,
            existing.successful_calls + (success ? 1 : 0),
            existing.failed_calls + (success ? 0 : 1),
            totalDuration, avgMs,
            new Date().toISOString(),
            toolName
        );
    }
}

export async function checkRateLimit(
    toolName: string,
    config?: RateLimitConfig
): Promise<{ allowed: boolean; reason?: string }> {
    if (!config) {
        return { allowed: true };
    }

    const db = getDb();
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    let row = db.prepare("SELECT * FROM rate_limit_state WHERE tool_name = ?").get(toolName) as any;
    if (!row) {
        db.prepare("INSERT INTO rate_limit_state (tool_name, minute_calls, hour_calls) VALUES (?, '[]', '[]')").run(toolName);
        return { allowed: true };
    }

    let minuteCalls: number[] = JSON.parse(row.minute_calls || "[]");
    let hourCalls: number[] = JSON.parse(row.hour_calls || "[]");

    minuteCalls = minuteCalls.filter(t => t > oneMinuteAgo);
    hourCalls = hourCalls.filter(t => t > oneHourAgo);

    db.prepare("UPDATE rate_limit_state SET minute_calls = ?, hour_calls = ? WHERE tool_name = ?")
        .run(JSON.stringify(minuteCalls), JSON.stringify(hourCalls), toolName);

    if (minuteCalls.length >= config.maxCallsPerMinute) {
        return {
            allowed: false,
            reason: `Rate limit exceeded: ${config.maxCallsPerMinute} calls per minute`
        };
    }

    if (hourCalls.length >= config.maxCallsPerHour) {
        return {
            allowed: false,
            reason: `Rate limit exceeded: ${config.maxCallsPerHour} calls per hour`
        };
    }

    return { allowed: true };
}

export async function recordRateLimitCall(toolName: string): Promise<void> {
    const db = getDb();
    const now = Date.now();

    let row = db.prepare("SELECT * FROM rate_limit_state WHERE tool_name = ?").get(toolName) as any;
    if (!row) {
        db.prepare("INSERT INTO rate_limit_state (tool_name, minute_calls, hour_calls) VALUES (?, ?, ?)")
            .run(toolName, JSON.stringify([now]), JSON.stringify([now]));
        return;
    }

    const minuteCalls: number[] = JSON.parse(row.minute_calls || "[]");
    const hourCalls: number[] = JSON.parse(row.hour_calls || "[]");
    minuteCalls.push(now);
    hourCalls.push(now);

    db.prepare("UPDATE rate_limit_state SET minute_calls = ?, hour_calls = ? WHERE tool_name = ?")
        .run(JSON.stringify(minuteCalls), JSON.stringify(hourCalls), toolName);
}

export async function getAllStats(): Promise<Record<string, ExecutionStats>> {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM execution_stats").all() as any[];
    const result: Record<string, ExecutionStats> = {};
    for (const row of rows) {
        result[row.tool_name] = {
            totalCalls: row.total_calls,
            successfulCalls: row.successful_calls,
            failedCalls: row.failed_calls,
            totalDurationMs: row.total_duration_ms,
            averageDurationMs: row.average_duration_ms,
            lastExecutedAt: row.last_executed_at || undefined
        };
    }
    return result;
}

export async function clearToolStats(toolName: string): Promise<void> {
    const db = getDb();
    db.prepare("DELETE FROM execution_stats WHERE tool_name = ?").run(toolName);
    db.prepare("DELETE FROM rate_limit_state WHERE tool_name = ?").run(toolName);
}

export async function clearAllStats(): Promise<void> {
    const db = getDb();
    db.prepare("DELETE FROM execution_stats").run();
    db.prepare("DELETE FROM rate_limit_state").run();
}

export function formatStats(stats: ExecutionStats): string {
    const successRate = stats.totalCalls > 0
        ? ((stats.successfulCalls / stats.totalCalls) * 100).toFixed(1)
        : "0.0";

    return [
        `Total Calls: ${stats.totalCalls}`,
        `Successful: ${stats.successfulCalls}`,
        `Failed: ${stats.failedCalls}`,
        `Success Rate: ${successRate}%`,
        `Avg Duration: ${stats.averageDurationMs}ms`,
        `Last Executed: ${stats.lastExecutedAt || "Never"}`
    ].join("\n");
}
