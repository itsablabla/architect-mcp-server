import { ScheduleConfig, CustomTool } from "../types.js";
import { CronExpressionParser } from "cron-parser";
import { runToolTests } from "../tools/testing.js";
import { getDb } from "../core/db.js";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerExecutor: ((toolName: string, params: Record<string, unknown>) => Promise<any>) | null = null;
let deprecationInterval: ReturnType<typeof setInterval> | null = null;
let deprecationToolReader: (() => Promise<CustomTool[]>) | null = null;
let deprecationToolWriter: ((tool: CustomTool) => Promise<void>) | null = null;

function calculateNextRun(cron: string): string | undefined {
    try {
        const interval = CronExpressionParser.parse(cron);
        const next = interval.next();
        const iso = next ? next.toISOString() : null;
        return iso ?? undefined;
    } catch {
        return undefined;
    }
}

export async function addSchedule(config: {
    toolName: string;
    cron: string;
    params: Record<string, unknown>;
    enabled?: boolean;
}): Promise<ScheduleConfig> {
    try {
        CronExpressionParser.parse(config.cron);
    } catch {
        throw new Error(`Invalid cron expression: ${config.cron}`);
    }

    const db = getDb();
    const id = `schedule_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const schedule: ScheduleConfig = {
        id,
        toolName: config.toolName,
        cron: config.cron,
        params: config.params,
        enabled: config.enabled !== false,
        nextRun: calculateNextRun(config.cron),
        createdAt: new Date().toISOString()
    };

    db.prepare(
        `INSERT INTO schedules (id, tool_name, cron, params, enabled, next_run, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, schedule.toolName, schedule.cron, JSON.stringify(schedule.params), schedule.enabled ? 1 : 0, schedule.nextRun || null, schedule.createdAt);

    return schedule;
}

export async function removeSchedule(id: string): Promise<boolean> {
    const db = getDb();
    const result = db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
    return result.changes > 0;
}

export async function getSchedule(id: string): Promise<ScheduleConfig | null> {
    const db = getDb();
    const row = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as any;
    if (!row) return null;
    return rowToSchedule(row);
}

export async function listAllSchedules(): Promise<ScheduleConfig[]> {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM schedules").all() as any[];
    return rows.map(rowToSchedule);
}

function rowToSchedule(row: any): ScheduleConfig {
    return {
        id: row.id,
        toolName: row.tool_name,
        cron: row.cron,
        params: JSON.parse(row.params || "{}"),
        enabled: row.enabled === 1,
        lastRun: row.last_run || undefined,
        nextRun: row.next_run || undefined,
        createdAt: row.created_at
    };
}

export async function updateScheduleLastRun(id: string): Promise<void> {
    const db = getDb();
    const row = db.prepare("SELECT cron FROM schedules WHERE id = ?").get(id) as any;
    if (!row) return;

    const nextRun = calculateNextRun(row.cron);
    db.prepare("UPDATE schedules SET last_run = ?, next_run = ? WHERE id = ?")
        .run(new Date().toISOString(), nextRun || null, id);
}

async function checkAndRunSchedules(): Promise<void> {
    if (!schedulerExecutor) return;

    const db = getDb();
    const rows = db.prepare("SELECT * FROM schedules WHERE enabled = 1 AND next_run IS NOT NULL").all() as any[];
    if (rows.length === 0) return;
    const now = new Date();

    for (const row of rows) {
        const nextRun = new Date(row.next_run);
        if (now >= nextRun) {
            try {
                await schedulerExecutor(row.tool_name, JSON.parse(row.params || "{}"));
            } catch {
            }
            await updateScheduleLastRun(row.id);
        }
    }
}

export function startScheduler(
    executor: (toolName: string, params: Record<string, unknown>) => Promise<any>
): void {
    if (schedulerInterval) return;

    schedulerExecutor = executor;
    schedulerInterval = setInterval(() => {
        checkAndRunSchedules().catch(() => { });
    }, 60000);
}

export function stopScheduler(): void {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
    }
    schedulerExecutor = null;
}

export function formatSchedule(schedule: ScheduleConfig): string {
    const status = schedule.enabled ? "ENABLED" : "DISABLED";
    return [
        `[${status}] ${schedule.id}`,
        `  Tool: ${schedule.toolName}`,
        `  Cron: ${schedule.cron}`,
        `  Last Run: ${schedule.lastRun || "Never"}`,
        `  Next Run: ${schedule.nextRun || "N/A"}`,
        `  Params: ${JSON.stringify(schedule.params)}`
    ].join("\n");
}

async function checkAndMarkDeprecated(): Promise<void> {
    if (!deprecationToolReader || !deprecationToolWriter) return;

    let tools: CustomTool[];
    try {
        tools = await deprecationToolReader();
    } catch {
        return;
    }

    for (const tool of tools) {
        if (!tool.tests || tool.tests.length === 0) continue;

        try {
            const result = await runToolTests(tool, {});
            const allFailed = result.failed === result.totalTests && result.totalTests > 0;

            if (allFailed && !tool.failingSince) {
                tool.failingSince = new Date().toISOString();
                await deprecationToolWriter(tool);
            } else if (!allFailed && tool.failingSince) {
                delete tool.failingSince;
                delete tool.deprecated;
                await deprecationToolWriter(tool);
            }
        } catch {
        }
    }
}

export function startDeprecationChecker(
    toolReader: () => Promise<CustomTool[]>,
    toolWriter: (tool: CustomTool) => Promise<void>,
    intervalMs = 6 * 60 * 60 * 1000
): void {
    if (deprecationInterval) return;
    deprecationToolReader = toolReader;
    deprecationToolWriter = toolWriter;
    deprecationInterval = setInterval(() => {
        checkAndMarkDeprecated().catch(() => { });
    }, intervalMs);
}

export function stopDeprecationChecker(): void {
    if (deprecationInterval) {
        clearInterval(deprecationInterval);
        deprecationInterval = null;
    }
    deprecationToolReader = null;
    deprecationToolWriter = null;
}
