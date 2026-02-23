import { Worker } from "worker_threads";
import * as fs from "fs/promises";
import * as path from "path";
import * as vm from "vm";
import { fileURLToPath } from "url";
import {
    Capability,
    NetCapability,
    FsCapability,
    ChildProcessCapability,
    EnvCapability
} from "../types.js";
import { createSecretsApi } from "./secrets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SandboxOptions {
    memoryLimitMB?: number;
    timeoutMs?: number;
    capabilities: Capability[];
    toolCaller?: (name: string, params: Record<string, unknown>) => Promise<any>;
}

export function extractLineNumber(error: Error, codeOffset: number = 4): number | null {
    const stack = error.stack || "";
    const match = stack.match(/<anonymous>:(\d+):(\d+)/);
    if (match) {
        const line = parseInt(match[1], 10);
        return Math.max(1, line - codeOffset);
    }
    return null;
}

export function formatErrorWithLine(error: Error, code: string): string {
    const lineNum = extractLineNumber(error);
    const message = error.message;

    if (lineNum !== null) {
        const lines = code.split("\n");
        const contextStart = Math.max(0, lineNum - 2);
        const contextEnd = Math.min(lines.length, lineNum + 2);

        let context = "\n\nCode context:\n";
        for (let i = contextStart; i < contextEnd; i++) {
            const marker = i === lineNum - 1 ? ">>> " : "    ";
            context += `${marker}${i + 1}: ${lines[i]}\n`;
        }

        return `Line ${lineNum}: ${message}${context}`;
    }

    return message;
}

export interface SandboxResult {
    success: boolean;
    result?: any;
    error?: string;
    logs: string[];
}

function matchPathPattern(pattern: string, pathname: string): boolean {
    const escaped = pattern
        .replace(/\*\*/g, "§§")
        .replace(/\{[^}]+\}/g, "[^/]+")
        .replace(/[.+^$()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*");
    return new RegExp(`^${escaped}$`).test(pathname);
}

function createNetworkApi(cap: NetCapability): (url: string, options?: RequestInit) => Promise<any> {
    return async (url: string, options?: RequestInit) => {
        const parsed = new URL(url);

        if (cap.domains && cap.domains.length > 0) {
            if (!cap.domains.includes(parsed.hostname)) {
                throw new Error(
                    `Network access to '${parsed.hostname}' not permitted. ` +
                    `Allowed domains: ${cap.domains.join(", ")}`
                );
            }
        }

        const method = ((options as any)?.method ?? "GET").toUpperCase();

        if (cap.allowedMethods && cap.allowedMethods.length > 0) {
            if (!cap.allowedMethods.includes(method)) {
                throw new Error(
                    `HTTP method '${method}' not permitted. ` +
                    `Allowed methods: ${cap.allowedMethods.join(", ")}`
                );
            }
        }

        if (cap.endpoints) {
            const scope = cap.endpoints[parsed.hostname];
            if (!scope) {
                throw new Error(
                    `No endpoint scope defined for host '${parsed.hostname}'.`
                );
            }
            if (scope.methods && scope.methods.length > 0 && !scope.methods.includes(method)) {
                throw new Error(
                    `HTTP method '${method}' not permitted for '${parsed.hostname}'. ` +
                    `Allowed: ${scope.methods.join(", ")}`
                );
            }
            if (scope.pathPattern && !matchPathPattern(scope.pathPattern, parsed.pathname)) {
                throw new Error(
                    `Path '${parsed.pathname}' does not match allowed pattern '${scope.pathPattern}' ` +
                    `for host '${parsed.hostname}'.`
                );
            }
        }

        const response = await fetch(url, options);
        const contentType = response.headers.get("content-type") || "";

        let body: any;
        if (contentType.includes("application/json")) {
            body = await response.json();
        } else {
            body = await response.text();
        }

        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body
        };
    };
}

function createFilesystemApi(cap: FsCapability) {
    const validatePath = (targetPath: string): void => {
        if (cap.paths && cap.paths.length > 0) {
            const resolved = path.resolve(targetPath);
            const allowed = cap.paths.some(p =>
                resolved.startsWith(path.resolve(p))
            );
            if (!allowed) {
                throw new Error(
                    `Filesystem access to '${targetPath}' not permitted. ` +
                    `Allowed paths: ${cap.paths.join(", ")}`
                );
            }
        }
    };

    return {
        readFile: cap.mode === "read" || cap.mode === "read_write"
            ? async (filePath: string) => { validatePath(filePath); return fs.readFile(filePath, "utf-8"); }
            : undefined,
        readdir: cap.mode === "read" || cap.mode === "read_write"
            ? async (dirPath: string) => { validatePath(dirPath); return fs.readdir(dirPath); }
            : undefined,
        writeFile: cap.mode === "write" || cap.mode === "read_write"
            ? async (filePath: string, content: string) => { validatePath(filePath); await fs.writeFile(filePath, content, "utf-8"); }
            : undefined
    };
}

function createChildProcessApi(cap: ChildProcessCapability) {
    return async (command: string, args: string[] = []) => {
        if (cap.commands && cap.commands.length > 0) {
            if (!cap.commands.includes(command)) {
                throw new Error(
                    `Command '${command}' not permitted. ` +
                    `Allowed commands: ${cap.commands.join(", ")}`
                );
            }
        }

        const { spawn } = await import("child_process");

        return new Promise((resolve, reject) => {
            const proc = spawn(command, args, {
                timeout: 30000,
                shell: false
            });

            let stdout = "";
            let stderr = "";

            proc.stdout?.on("data", (data) => {
                stdout += data.toString();
            });

            proc.stderr?.on("data", (data) => {
                stderr += data.toString();
            });

            proc.on("close", (code) => {
                resolve({ stdout, stderr, code: code ?? 0 });
            });

            proc.on("error", (error) => {
                reject(error);
            });
        });
    };
}

function createEnvApi(cap: EnvCapability) {
    return {
        get: (name: string): string | undefined => {
            if (cap.variables && cap.variables.length > 0) {
                if (!cap.variables.includes(name)) {
                    throw new Error(
                        `Access to env var '${name}' not permitted. ` +
                        `Allowed variables: ${cap.variables.join(", ")}`
                    );
                }
            }
            return process.env[name];
        }
    };
}

export class ToolSandbox {
    private options: SandboxOptions & { memoryLimitMB: number; timeoutMs: number };
    private logs: string[] = [];
    private originalCode: string = "";
    private worker: Worker | null = null;
    private capabilityHandlers: Map<string, any> = new Map();

    constructor(options: SandboxOptions) {
        this.options = {
            memoryLimitMB: options.memoryLimitMB ?? 128,
            timeoutMs: options.timeoutMs ?? 10000,
            capabilities: options.capabilities,
            toolCaller: options.toolCaller
        };

        for (const cap of this.options.capabilities) {
            switch (cap.type) {
                case "net":
                    this.capabilityHandlers.set("net", { fetch: createNetworkApi(cap) });
                    break;
                case "fs":
                    this.capabilityHandlers.set("fs", createFilesystemApi(cap));
                    break;
                case "child_process":
                    this.capabilityHandlers.set("child_process", { exec: createChildProcessApi(cap) });
                    break;
                case "env":
                    this.capabilityHandlers.set("env", createEnvApi(cap));
                    break;
            }
        }
    }

    private async handleCapabilityRequest(msg: any): Promise<any> {
        const { capType, method, args } = msg;

        if (capType === "secrets") {
            const secretsApi = createSecretsApi();
            return secretsApi.get(args[0]);
        }

        if (capType === "callTool" && this.options.toolCaller) {
            return this.options.toolCaller(args[0], args[1]);
        }

        const handler = this.capabilityHandlers.get(capType);
        if (!handler) {
            throw new Error(`Capability '${capType}' not approved`);
        }

        if (capType === "net") {
            return handler.fetch(...args);
        }
        if (capType === "fs") {
            const fn = handler[method];
            if (!fn) throw new Error(`Filesystem method '${method}' not permitted`);
            return fn(...args);
        }
        if (capType === "child_process") {
            return handler.exec(...args);
        }
        if (capType === "env") {
            return handler.get(...args);
        }

        throw new Error(`Unknown capability type: ${capType}`);
    }

    async execute(code: string, params: Record<string, unknown>): Promise<SandboxResult> {
        this.logs = [];
        this.originalCode = code;

        const capabilityTypes = this.options.capabilities.map(c => c.type);
        const workerPath = path.resolve(__dirname, "tool-worker.js");

        return new Promise<SandboxResult>((resolve) => {
            let settled = false;

            const worker = new Worker(workerPath, {
                workerData: { code, params, capabilityTypes },
                resourceLimits: {
                    maxOldGenerationSizeMb: this.options.memoryLimitMB,
                    maxYoungGenerationSizeMb: this.options.memoryLimitMB / 4
                }
            });

            this.worker = worker;

            const timeoutId = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    worker.terminate();
                    resolve({
                        success: false,
                        error: `Execution timed out after ${this.options.timeoutMs}ms`,
                        logs: this.logs
                    });
                }
            }, this.options.timeoutMs);

            worker.on("message", async (msg: any) => {
                if (msg.type === "capability_request") {
                    try {
                        const result = await this.handleCapabilityRequest(msg);
                        worker.postMessage({
                            type: "capability_response",
                            id: msg.id,
                            result
                        });
                    } catch (err) {
                        worker.postMessage({
                            type: "capability_response",
                            id: msg.id,
                            error: err instanceof Error ? err.message : String(err)
                        });
                    }
                } else if (msg.type === "result") {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timeoutId);
                        this.logs = msg.logs || [];
                        if (msg.success) {
                            resolve({
                                success: true,
                                result: msg.result,
                                logs: this.logs
                            });
                        } else {
                            resolve({
                                success: false,
                                error: msg.error,
                                logs: this.logs
                            });
                        }
                        worker.terminate();
                    }
                }
            });

            worker.on("error", (err: Error) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve({
                        success: false,
                        error: err.message,
                        logs: this.logs
                    });
                }
            });

            worker.on("exit", (exitCode) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve({
                        success: false,
                        error: `Worker exited unexpectedly with code ${exitCode}`,
                        logs: this.logs
                    });
                }
            });
        });
    }

    dispose(): void {
        this.logs = [];
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}

export async function executeInSandbox(
    code: string,
    params: Record<string, unknown>,
    capabilities: Capability[]
): Promise<SandboxResult> {
    const sandbox = new ToolSandbox({ capabilities });
    try {
        return await sandbox.execute(code, params);
    } finally {
        sandbox.dispose();
    }
}

export interface ValidationResult {
    valid: boolean;
    error?: string;
    line?: number;
}

export function validateCode(code: string): ValidationResult {
    const wrappedCode = `(async (params) => { ${code} })`;

    try {
        new vm.Script(wrappedCode);
        return { valid: true };
    } catch (error) {
        if (error instanceof SyntaxError) {
            const match = error.stack?.match(/:(\d+)/);
            const line = match ? parseInt(match[1], 10) : undefined;
            return {
                valid: false,
                error: error.message,
                line
            };
        }
        return {
            valid: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
