import { CustomTool, TestCase, TestResult, TestRunResult } from "../types.js";
import { ToolSandbox, SandboxOptions } from "../core/sandbox.js";

export async function runToolTests(
    tool: CustomTool,
    sandboxOptions: Omit<SandboxOptions, "capabilities">
): Promise<TestRunResult> {
    const tests = tool.tests || [];
    const results: TestResult[] = [];
    const startTime = Date.now();

    for (const testCase of tests) {
        const result = await runSingleTest(tool, testCase, sandboxOptions);
        results.push(result);
    }

    const totalMs = Date.now() - startTime;
    const passed = results.filter(r => r.passed).length;

    return {
        toolName: tool.name,
        totalTests: results.length,
        passed,
        failed: results.length - passed,
        results,
        durationMs: totalMs
    };
}

async function runSingleTest(
    tool: CustomTool,
    testCase: TestCase,
    sandboxOptions: Omit<SandboxOptions, "capabilities">
): Promise<TestResult> {
    const startTime = Date.now();
    const timeout = testCase.timeout || 10000;

    const sandbox = new ToolSandbox({
        ...sandboxOptions,
        capabilities: tool.capabilities,
        timeoutMs: timeout
    });

    try {
        const result = await sandbox.execute(tool.code, testCase.input);
        const durationMs = Date.now() - startTime;

        if (testCase.expectError) {
            if (!result.success && result.error?.includes(testCase.expectError)) {
                return { name: testCase.name, passed: true, durationMs };
            }
            return {
                name: testCase.name,
                passed: false,
                expected: `Error: ${testCase.expectError}`,
                actual: result.success ? result.result : result.error,
                durationMs
            };
        }

        if (!result.success) {
            return {
                name: testCase.name,
                passed: false,
                error: result.error,
                durationMs
            };
        }

        if (testCase.expect !== undefined) {
            const expectedStr = JSON.stringify(testCase.expect);
            const actualStr = JSON.stringify(result.result);

            if (expectedStr === actualStr) {
                return { name: testCase.name, passed: true, actual: result.result, expected: testCase.expect, durationMs };
            }

            return {
                name: testCase.name,
                passed: false,
                expected: testCase.expect,
                actual: result.result,
                durationMs
            };
        }

        return { name: testCase.name, passed: true, actual: result.result, durationMs };
    } catch (err) {
        return {
            name: testCase.name,
            passed: false,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - startTime
        };
    } finally {
        sandbox.dispose();
    }
}

export function formatTestResults(result: TestRunResult): string {
    const lines = [
        `Test Results for '${result.toolName}'`,
        `Total: ${result.totalTests} | Passed: ${result.passed} | Failed: ${result.failed} | Duration: ${result.durationMs}ms`,
        ""
    ];

    for (const r of result.results) {
        const icon = r.passed ? "✓" : "✗";
        lines.push(`  ${icon} ${r.name} (${r.durationMs}ms)`);
        if (!r.passed) {
            if (r.error) lines.push(`    Error: ${r.error}`);
            if (r.expected !== undefined) lines.push(`    Expected: ${JSON.stringify(r.expected)}`);
            if (r.actual !== undefined) lines.push(`    Actual: ${JSON.stringify(r.actual)}`);
        }
    }

    return lines.join("\n");
}
