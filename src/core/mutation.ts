import { MutationCandidate, AnomalyRecord, CustomTool, ExecutionStats } from "../types.js";
import { getActiveAnomalies } from "./anomaly.js";

export async function getMutationCandidates(): Promise<MutationCandidate[]> {
    const anomalies = await getActiveAnomalies();
    const candidates: MutationCandidate[] = [];

    for (const anomaly of anomalies) {
        let priority: "high" | "medium" | "low" = "medium";
        let suggestedAction = "Review logic and performance";

        const failRateJump = anomaly.currentFailRate - anomaly.baselineFailRate;
        const durationSpike = anomaly.baselineAvgDurationMs > 0
            ? anomaly.currentAvgDurationMs / anomaly.baselineAvgDurationMs
            : 0;

        if (failRateJump > 0.4 || durationSpike > 5) {
            priority = "high";
            suggestedAction = failRateJump > 0.4 ? "Fix critical logic errors" : "Significant performance optimization required";
        } else if (failRateJump < 0.1 && durationSpike < 2) {
            priority = "low";
            suggestedAction = "Minor optimization recommended";
        }

        candidates.push({
            toolName: anomaly.toolName,
            anomaly,
            suggestedAction,
            priority
        });
    }

    return candidates.sort((a, b) => {
        const pMap = { high: 0, medium: 1, low: 2 };
        return pMap[a.priority] - pMap[b.priority];
    });
}

export async function getMutationContext(
    toolName: string,
    readTool: (name: string) => Promise<CustomTool>,
    getStats: (name: string) => Promise<ExecutionStats | null>,
    getLogs: (name: string, limit: number) => Promise<any[]>
): Promise<{
    tool: CustomTool;
    stats: ExecutionStats | null;
    recentLogs: any[];
    anomaly: AnomalyRecord | null;
}> {
    const tool = await readTool(toolName);
    const stats = await getStats(toolName);
    const recentLogs = await getLogs(toolName, 10);
    const anomalies = await getActiveAnomalies();
    const anomaly = anomalies.find(a => a.toolName === toolName) || null;

    return {
        tool,
        stats,
        recentLogs: recentLogs.map(l => ({
            timestamp: l.timestamp,
            action: l.action,
            details: l.details,
            duration: l.duration
        })),
        anomaly
    };
}
