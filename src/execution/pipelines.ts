import { Pipeline, PipelineStep } from "../types.js";
import { getDb } from "../core/db.js";

export async function createPipeline(
    name: string,
    description: string,
    steps: PipelineStep[]
): Promise<Pipeline> {
    const db = getDb();
    const now = new Date().toISOString();

    const pipeline: Pipeline = {
        name,
        description,
        steps,
        createdAt: now,
        updatedAt: now
    };

    db.prepare(
        `INSERT OR REPLACE INTO pipelines (name, description, steps, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(name, description, JSON.stringify(steps), now, now);

    return pipeline;
}

export async function getPipeline(name: string): Promise<Pipeline | null> {
    const db = getDb();
    const row = db.prepare("SELECT * FROM pipelines WHERE name = ?").get(name) as any;
    if (!row) return null;
    return {
        name: row.name,
        description: row.description,
        steps: JSON.parse(row.steps),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

export async function deletePipeline(name: string): Promise<boolean> {
    const db = getDb();
    const result = db.prepare("DELETE FROM pipelines WHERE name = ?").run(name);
    return result.changes > 0;
}

export async function listAllPipelines(): Promise<Pipeline[]> {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM pipelines").all() as any[];
    return rows.map(row => ({
        name: row.name,
        description: row.description,
        steps: JSON.parse(row.steps),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }));
}

function substituteVariables(
    params: Record<string, unknown>,
    context: Record<string, any>
): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
        if (typeof value === "string" && value.startsWith("$")) {
            const parts = value.substring(1).split(".");
            let resolved: any = context;
            for (const part of parts) {
                resolved = resolved?.[part];
            }
            result[key] = resolved;
        } else {
            result[key] = value;
        }
    }

    return result;
}

export interface PipelineExecutionResult {
    pipelineName: string;
    steps: Array<{
        tool: string;
        success: boolean;
        result?: any;
        error?: string;
        durationMs: number;
    }>;
    totalMs: number;
    success: boolean;
    finalResult?: any;
}

export async function executePipeline(
    pipeline: Pipeline,
    executor: (toolName: string, params: Record<string, unknown>) => Promise<any>,
    initialInput?: Record<string, unknown>
): Promise<PipelineExecutionResult> {
    const startTime = Date.now();
    const stepResults: PipelineExecutionResult["steps"] = [];
    const context: Record<string, any> = {
        input: initialInput || {},
        prev: { result: null }
    };

    for (const step of pipeline.steps) {
        const stepStart = Date.now();

        if (step.condition) {
            try {
                const condResult = new Function("ctx", `return ${step.condition}`)(context);
                if (!condResult) {
                    stepResults.push({
                        tool: step.tool,
                        success: true,
                        result: "skipped (condition false)",
                        durationMs: 0
                    });
                    continue;
                }
            } catch {
            }
        }

        const resolvedParams = substituteVariables(step.params, context);

        try {
            const result = await executor(step.tool, resolvedParams);
            const durationMs = Date.now() - stepStart;

            context.prev = { result };
            if (step.outputAs) {
                context[step.outputAs] = { result };
            }

            stepResults.push({ tool: step.tool, success: true, result, durationMs });
        } catch (err) {
            const durationMs = Date.now() - stepStart;
            const error = err instanceof Error ? err.message : String(err);

            stepResults.push({ tool: step.tool, success: false, error, durationMs });

            return {
                pipelineName: pipeline.name,
                steps: stepResults,
                totalMs: Date.now() - startTime,
                success: false
            };
        }
    }

    return {
        pipelineName: pipeline.name,
        steps: stepResults,
        totalMs: Date.now() - startTime,
        success: true,
        finalResult: context.prev?.result
    };
}

export function formatPipelineResult(result: PipelineExecutionResult): string {
    const lines = [
        `Pipeline: ${result.pipelineName}`,
        `Status: ${result.success ? "SUCCESS" : "FAILED"} | Duration: ${result.totalMs}ms`,
        ""
    ];

    for (let i = 0; i < result.steps.length; i++) {
        const s = result.steps[i];
        const icon = s.success ? "✓" : "✗";
        lines.push(`  ${icon} Step ${i + 1}: ${s.tool} (${s.durationMs}ms)`);
        if (!s.success && s.error) {
            lines.push(`    Error: ${s.error}`);
        }
    }

    if (result.success && result.finalResult !== undefined) {
        lines.push("");
        lines.push(`Final Result: ${JSON.stringify(result.finalResult, null, 2)}`);
    }

    return lines.join("\n");
}
