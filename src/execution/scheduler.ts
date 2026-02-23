import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { ScheduleConfig, ScheduleStore, CustomTool } from "../types.js";
import { CronExpressionParser } from "cron-parser";
import { runToolTests } from "../tools/testing.js";
import { fileExists } from "../core/utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEDULES_FILE = path.resolve(__dirname, "..", "schedules.json");
const SCHEDULES_SCHEMA_VERSION = 1;

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerExecutor: ((toolName: string, params: Record<string, unknown>) => Promise<any>) | null = null;
let deprecationInterval: ReturnType<typeof setInterval> | null = null;
let deprecationToolReader: (() => Promise<CustomTool[]>) | null = null;
let deprecationToolWriter: ((tool: CustomTool) => Promise<void>) | null = null;



export async function loadSchedules(): Promise<ScheduleStore> {
    if (!await fileExists(SCHEDULES_FILE)) {
        return { version: SCHEDULES_SCHEMA_VERSION, schedules: {} };
    }

    try {
        const content = await fs.readFile(SCHEDULES_FILE, "utf-8");
        const data = JSON.parse(content) as ScheduleStore;
        return {
            version: data.version || SCHEDULES_SCHEMA_VERSION,
            schedules: data.schedules || {}
        };
    } catch {
        return { version: SCHEDULES_SCHEMA_VERSION, schedules: {} };
    }
}

export async function saveSchedules(store: ScheduleStore): Promise<void> {
    await fs.writeFile(SCHEDULES_FILE, JSON.stringify(store, null, 2));
}

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
    const store = await loadSchedules();
    const id = `schedule_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    try {
        CronExpressionParser.parse(config.cron);
    } catch {
        throw new Error(`Invalid cron expression: ${config.cron}`);
    }

    const schedule: ScheduleConfig = {
        id,
        toolName: config.toolName,
        cron: config.cron,
        params: config.params,
        enabled: config.enabled !== false,
        nextRun: calculateNextRun(config.cron),
        createdAt: new Date().toISOString()
    };

    store.schedules[id] = schedule;
    await saveSchedules(store);
    return schedule;
}

export async function removeSchedule(id: string): Promise<boolean> {
    const store = await loadSchedules();
    if (!store.schedules[id]) return false;
    delete store.schedules[id];
    await saveSchedules(store);
    return true;
}

export async function getSchedule(id: string): Promise<ScheduleConfig | null> {
    const store = await loadSchedules();
    return store.schedules[id] || null;
}

export async function listAllSchedules(): Promise<ScheduleConfig[]> {
    const store = await loadSchedules();
    return Object.values(store.schedules);
}

export async function updateScheduleLastRun(id: string): Promise<void> {
    const store = await loadSchedules();
    const schedule = store.schedules[id];
    if (!schedule) return;

    schedule.lastRun = new Date().toISOString();
    schedule.nextRun = calculateNextRun(schedule.cron);
    await saveSchedules(store);
}

async function checkAndRunSchedules(): Promise<void> {
    if (!schedulerExecutor) return;

    const store = await loadSchedules();
    if (Object.keys(store.schedules).length === 0) return;
    const now = new Date();

    for (const schedule of Object.values(store.schedules)) {
        if (!schedule.enabled) continue;
        if (!schedule.nextRun) continue;

        const nextRun = new Date(schedule.nextRun);
        if (now >= nextRun) {
            try {
                await schedulerExecutor(schedule.toolName, schedule.params);
            } catch {
            }
            await updateScheduleLastRun(schedule.id);
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
