import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { AnomalyRecord, AnomalyStore, ExecutionStats } from "../types.js";
import { getAllStats } from "./history.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANOMALY_FILE = path.resolve(__dirname, "..", "anomalies.json");
const ANOMALY_SCHEMA_VERSION = 1;

const DURATION_SPIKE_FACTOR = 3;
const FAIL_RATE_SPIKE_THRESHOLD = 0.2;
const MIN_CALLS_FOR_BASELINE = 5;

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function loadAnomalyStore(): Promise<AnomalyStore> {
    if (!await fileExists(ANOMALY_FILE)) {
        return { version: ANOMALY_SCHEMA_VERSION, baselines: {}, anomalies: {} };
    }
    try {
        const content = await fs.readFile(ANOMALY_FILE, "utf-8");
        const data = JSON.parse(content) as AnomalyStore;
        return {
            version: data.version || ANOMALY_SCHEMA_VERSION,
            baselines: data.baselines || {},
            anomalies: data.anomalies || {}
        };
    } catch {
        return { version: ANOMALY_SCHEMA_VERSION, baselines: {}, anomalies: {} };
    }
}

async function saveAnomalyStore(store: AnomalyStore): Promise<void> {
    await fs.writeFile(ANOMALY_FILE, JSON.stringify(store, null, 2));
}

function computeFailRate(stats: ExecutionStats): number {
    if (stats.totalCalls === 0) return 0;
    return stats.failedCalls / stats.totalCalls;
}

export async function runAnomalyCheck(): Promise<AnomalyRecord[]> {
    const store = await loadAnomalyStore();
    const allStats = await getAllStats();
    const now = new Date().toISOString();
    const detected: AnomalyRecord[] = [];

    for (const [toolName, stats] of Object.entries(allStats)) {
        if (stats.totalCalls < MIN_CALLS_FOR_BASELINE) continue;

        const baseline = store.baselines[toolName];

        if (!baseline) {
            store.baselines[toolName] = {
                avgDurationMs: stats.averageDurationMs,
                failRate: computeFailRate(stats),
                sampledAt: now,
                totalCallsAtSample: stats.totalCalls
            };
            continue;
        }

        const currentFailRate = computeFailRate(stats);
        const anomalies: string[] = [];

        if (baseline.avgDurationMs > 0 && stats.averageDurationMs > baseline.avgDurationMs * DURATION_SPIKE_FACTOR) {
            anomalies.push(`duration spiked ${(stats.averageDurationMs / baseline.avgDurationMs).toFixed(1)}x (baseline: ${baseline.avgDurationMs}ms, now: ${stats.averageDurationMs}ms)`);
        }

        if (currentFailRate > baseline.failRate + FAIL_RATE_SPIKE_THRESHOLD) {
            const baselinePct = (baseline.failRate * 100).toFixed(1);
            const currentPct = (currentFailRate * 100).toFixed(1);
            anomalies.push(`fail rate jumped from ${baselinePct}% to ${currentPct}%`);
        }

        if (anomalies.length > 0) {
            const record: AnomalyRecord = {
                toolName,
                detectedAt: now,
                reasons: anomalies,
                baselineAvgDurationMs: baseline.avgDurationMs,
                currentAvgDurationMs: stats.averageDurationMs,
                baselineFailRate: baseline.failRate,
                currentFailRate
            };
            store.anomalies[toolName] = record;
            detected.push(record);
        } else {
            delete store.anomalies[toolName];

            if (stats.totalCalls > baseline.totalCallsAtSample * 2) {
                store.baselines[toolName] = {
                    avgDurationMs: stats.averageDurationMs,
                    failRate: currentFailRate,
                    sampledAt: now,
                    totalCallsAtSample: stats.totalCalls
                };
            }
        }
    }

    await saveAnomalyStore(store);
    return detected;
}

export async function getActiveAnomalies(): Promise<AnomalyRecord[]> {
    const store = await loadAnomalyStore();
    return Object.values(store.anomalies);
}

export async function clearAnomaly(toolName: string): Promise<boolean> {
    const store = await loadAnomalyStore();
    if (!store.anomalies[toolName]) return false;
    delete store.anomalies[toolName];
    await saveAnomalyStore(store);
    return true;
}

export async function resetBaseline(toolName: string): Promise<boolean> {
    const store = await loadAnomalyStore();
    const allStats = await getAllStats();
    const stats = allStats[toolName];
    if (!stats) return false;

    store.baselines[toolName] = {
        avgDurationMs: stats.averageDurationMs,
        failRate: computeFailRate(stats),
        sampledAt: new Date().toISOString(),
        totalCallsAtSample: stats.totalCalls
    };
    delete store.anomalies[toolName];
    await saveAnomalyStore(store);
    return true;
}

let anomalyInterval: ReturnType<typeof setInterval> | null = null;

export function startAnomalyChecker(intervalMs = 15 * 60 * 1000): void {
    if (anomalyInterval) return;
    anomalyInterval = setInterval(() => {
        runAnomalyCheck().catch(() => { });
    }, intervalMs);
}

export function stopAnomalyChecker(): void {
    if (anomalyInterval) {
        clearInterval(anomalyInterval);
        anomalyInterval = null;
    }
}
