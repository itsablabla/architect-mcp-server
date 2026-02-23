import { AnomalyRecord, ExecutionStats } from "../types.js";
import { getAllStats } from "./history.js";
import { getDb } from "./db.js";

const DURATION_SPIKE_FACTOR = 3;
const FAIL_RATE_SPIKE_THRESHOLD = 0.2;
const MIN_CALLS_FOR_BASELINE = 5;

function computeFailRate(stats: ExecutionStats): number {
    if (stats.totalCalls === 0) return 0;
    return stats.failedCalls / stats.totalCalls;
}

export async function runAnomalyCheck(): Promise<AnomalyRecord[]> {
    const db = getDb();
    const allStats = await getAllStats();
    const now = new Date().toISOString();
    const detected: AnomalyRecord[] = [];

    for (const [toolName, stats] of Object.entries(allStats)) {
        if (stats.totalCalls < MIN_CALLS_FOR_BASELINE) continue;

        const baseline = db.prepare("SELECT * FROM anomaly_baselines WHERE tool_name = ?").get(toolName) as any;

        if (!baseline) {
            db.prepare(
                `INSERT INTO anomaly_baselines (tool_name, avg_duration_ms, fail_rate, sampled_at, total_calls_at_sample)
                 VALUES (?, ?, ?, ?, ?)`
            ).run(toolName, stats.averageDurationMs, computeFailRate(stats), now, stats.totalCalls);
            continue;
        }

        const currentFailRate = computeFailRate(stats);
        const anomalies: string[] = [];

        if (baseline.avg_duration_ms > 0 && stats.averageDurationMs > baseline.avg_duration_ms * DURATION_SPIKE_FACTOR) {
            anomalies.push(`duration spiked ${(stats.averageDurationMs / baseline.avg_duration_ms).toFixed(1)}x (baseline: ${baseline.avg_duration_ms}ms, now: ${stats.averageDurationMs}ms)`);
        }

        if (currentFailRate > baseline.fail_rate + FAIL_RATE_SPIKE_THRESHOLD) {
            const baselinePct = (baseline.fail_rate * 100).toFixed(1);
            const currentPct = (currentFailRate * 100).toFixed(1);
            anomalies.push(`fail rate jumped from ${baselinePct}% to ${currentPct}%`);
        }

        if (anomalies.length > 0) {
            const record: AnomalyRecord = {
                toolName,
                detectedAt: now,
                reasons: anomalies,
                baselineAvgDurationMs: baseline.avg_duration_ms,
                currentAvgDurationMs: stats.averageDurationMs,
                baselineFailRate: baseline.fail_rate,
                currentFailRate
            };
            db.prepare(
                `INSERT OR REPLACE INTO anomaly_records (tool_name, detected_at, reasons, baseline_avg_duration_ms, current_avg_duration_ms, baseline_fail_rate, current_fail_rate)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).run(toolName, now, JSON.stringify(anomalies), baseline.avg_duration_ms, stats.averageDurationMs, baseline.fail_rate, currentFailRate);
            detected.push(record);
        } else {
            db.prepare("DELETE FROM anomaly_records WHERE tool_name = ?").run(toolName);

            if (stats.totalCalls > baseline.total_calls_at_sample * 2) {
                db.prepare(
                    `UPDATE anomaly_baselines SET avg_duration_ms = ?, fail_rate = ?, sampled_at = ?, total_calls_at_sample = ?
                     WHERE tool_name = ?`
                ).run(stats.averageDurationMs, currentFailRate, now, stats.totalCalls, toolName);
            }
        }
    }

    return detected;
}

export async function getActiveAnomalies(): Promise<AnomalyRecord[]> {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM anomaly_records").all() as any[];
    return rows.map(row => ({
        toolName: row.tool_name,
        detectedAt: row.detected_at,
        reasons: JSON.parse(row.reasons),
        baselineAvgDurationMs: row.baseline_avg_duration_ms,
        currentAvgDurationMs: row.current_avg_duration_ms,
        baselineFailRate: row.baseline_fail_rate,
        currentFailRate: row.current_fail_rate
    }));
}

export async function clearAnomaly(toolName: string): Promise<boolean> {
    const db = getDb();
    const result = db.prepare("DELETE FROM anomaly_records WHERE tool_name = ?").run(toolName);
    return result.changes > 0;
}

export async function resetBaseline(toolName: string): Promise<boolean> {
    const allStats = await getAllStats();
    const stats = allStats[toolName];
    if (!stats) return false;

    const db = getDb();
    db.prepare(
        `INSERT OR REPLACE INTO anomaly_baselines (tool_name, avg_duration_ms, fail_rate, sampled_at, total_calls_at_sample)
         VALUES (?, ?, ?, ?, ?)`
    ).run(toolName, stats.averageDurationMs, computeFailRate(stats), new Date().toISOString(), stats.totalCalls);
    db.prepare("DELETE FROM anomaly_records WHERE tool_name = ?").run(toolName);
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
