import { BatchResult, BatchExecutionResult } from "../types.js";

export async function executeBatch(
    toolName: string,
    inputs: Record<string, unknown>[],
    concurrency: number,
    executor: (params: Record<string, unknown>) => Promise<any>
): Promise<BatchExecutionResult> {
    const startTime = Date.now();
    const results: BatchResult[] = [];
    const limit = Math.max(1, Math.min(concurrency, 20));

    for (let i = 0; i < inputs.length; i += limit) {
        const chunk = inputs.slice(i, i + limit);
        const chunkResults = await Promise.allSettled(
            chunk.map(async (input) => {
                const inputStart = Date.now();
                try {
                    const output = await executor(input);
                    return {
                        input,
                        output,
                        success: true,
                        durationMs: Date.now() - inputStart
                    } as BatchResult;
                } catch (err) {
                    return {
                        input,
                        output: null,
                        success: false,
                        error: err instanceof Error ? err.message : String(err),
                        durationMs: Date.now() - inputStart
                    } as BatchResult;
                }
            })
        );

        for (const r of chunkResults) {
            if (r.status === "fulfilled") {
                results.push(r.value);
            } else {
                results.push({
                    input: {},
                    output: null,
                    success: false,
                    error: r.reason?.message || String(r.reason),
                    durationMs: 0
                });
            }
        }
    }

    return {
        toolName,
        results,
        totalMs: Date.now() - startTime,
        successCount: results.filter(r => r.success).length,
        failCount: results.filter(r => !r.success).length
    };
}

export function formatBatchResult(result: BatchExecutionResult): string {
    const lines = [
        `Batch Execution: ${result.toolName}`,
        `Total: ${result.results.length} | Success: ${result.successCount} | Failed: ${result.failCount} | Duration: ${result.totalMs}ms`,
        ""
    ];

    for (let i = 0; i < result.results.length; i++) {
        const r = result.results[i];
        const icon = r.success ? "✓" : "✗";
        const detail = r.success
            ? JSON.stringify(r.output)
            : r.error;
        lines.push(`  ${icon} [${i}] (${r.durationMs}ms): ${detail}`);
    }

    return lines.join("\n");
}
