import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import {
    ExecutionHistoryStore,
    ExecutionStats,
    RateLimitConfig,
    RateLimitState
} from "../types.js";
import { fileExists } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.resolve(__dirname, "..", "execution_history.json");
const HISTORY_SCHEMA_VERSION = 1;



export async function loadHistory(): Promise<ExecutionHistoryStore> {
    if (!await fileExists(HISTORY_FILE)) {
        return {
            version: HISTORY_SCHEMA_VERSION,
            stats: {},
            rateLimitState: {}
        };
    }

    try {
        const content = await fs.readFile(HISTORY_FILE, "utf-8");
        const data = JSON.parse(content) as ExecutionHistoryStore;
        return {
            version: data.version || HISTORY_SCHEMA_VERSION,
            stats: data.stats || {},
            rateLimitState: data.rateLimitState || {}
        };
    } catch {
        return {
            version: HISTORY_SCHEMA_VERSION,
            stats: {},
            rateLimitState: {}
        };
    }
}

export async function saveHistory(store: ExecutionHistoryStore): Promise<void> {
    await fs.writeFile(HISTORY_FILE, JSON.stringify(store, null, 2));
}

export async function getToolStats(toolName: string): Promise<ExecutionStats | null> {
    const store = await loadHistory();
    return store.stats[toolName] || null;
}

export async function recordExecution(
    toolName: string,
    success: boolean,
    durationMs: number
): Promise<void> {
    const store = await loadHistory();

    if (!store.stats[toolName]) {
        store.stats[toolName] = {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            totalDurationMs: 0,
            averageDurationMs: 0
        };
    }

    const stats = store.stats[toolName];
    stats.totalCalls++;
    stats.totalDurationMs += durationMs;
    stats.averageDurationMs = Math.round(stats.totalDurationMs / stats.totalCalls);
    stats.lastExecutedAt = new Date().toISOString();

    if (success) {
        stats.successfulCalls++;
    } else {
        stats.failedCalls++;
    }

    await saveHistory(store);
}

export async function checkRateLimit(
    toolName: string,
    config?: RateLimitConfig
): Promise<{ allowed: boolean; reason?: string }> {
    if (!config) {
        return { allowed: true };
    }

    const store = await loadHistory();
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    if (!store.rateLimitState[toolName]) {
        store.rateLimitState[toolName] = {
            minuteCalls: [],
            hourCalls: []
        };
    }

    const state = store.rateLimitState[toolName];

    state.minuteCalls = state.minuteCalls.filter(t => t > oneMinuteAgo);
    state.hourCalls = state.hourCalls.filter(t => t > oneHourAgo);

    if (state.minuteCalls.length >= config.maxCallsPerMinute) {
        return {
            allowed: false,
            reason: `Rate limit exceeded: ${config.maxCallsPerMinute} calls per minute`
        };
    }

    if (state.hourCalls.length >= config.maxCallsPerHour) {
        return {
            allowed: false,
            reason: `Rate limit exceeded: ${config.maxCallsPerHour} calls per hour`
        };
    }

    return { allowed: true };
}

export async function recordRateLimitCall(toolName: string): Promise<void> {
    const store = await loadHistory();
    const now = Date.now();

    if (!store.rateLimitState[toolName]) {
        store.rateLimitState[toolName] = {
            minuteCalls: [],
            hourCalls: []
        };
    }

    store.rateLimitState[toolName].minuteCalls.push(now);
    store.rateLimitState[toolName].hourCalls.push(now);

    await saveHistory(store);
}

export async function getAllStats(): Promise<Record<string, ExecutionStats>> {
    const store = await loadHistory();
    return store.stats;
}

export async function clearToolStats(toolName: string): Promise<void> {
    const store = await loadHistory();
    delete store.stats[toolName];
    delete store.rateLimitState[toolName];
    await saveHistory(store);
}

export async function clearAllStats(): Promise<void> {
    await saveHistory({
        version: HISTORY_SCHEMA_VERSION,
        stats: {},
        rateLimitState: {}
    });
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
