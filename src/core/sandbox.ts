import * as vm from "vm";
import * as fs from "fs/promises";
import * as path from "path";
import {
    Capability,
    NetCapability,
    FsCapability,
    ChildProcessCapability,
    EnvCapability
} from "../types.js";
import { createSecretsApi } from "./secrets.js";

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

interface SandboxContext {
    params: Record<string, unknown>;
    console: {
        log: (...args: any[]) => void;
        error: (...args: any[]) => void;
        warn: (...args: any[]) => void;
    };
    JSON: typeof JSON;
    Math: typeof Math;
    Date: typeof Date;
    Array: typeof Array;
    Object: typeof Object;
    String: typeof String;
    Number: typeof Number;
    Boolean: typeof Boolean;
    Promise: typeof Promise;
    fetch?: (url: string, options?: RequestInit) => Promise<any>;
    fs?: {
        readFile?: (filePath: string) => Promise<string>;
        writeFile?: (filePath: string, content: string) => Promise<void>;
        readdir?: (dirPath: string) => Promise<string[]>;
    };
    exec?: (command: string, args?: string[]) => Promise<{ stdout: string; stderr: string; code: number }>;
    env?: {
        get: (name: string) => string | undefined;
    };
    callTool?: (name: string, params: Record<string, unknown>) => Promise<any>;
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    __resolve: (value: any) => void;
    __reject: (error: any) => void;
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

function createFilesystemApi(cap: FsCapability): SandboxContext["fs"] {
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

    const api: SandboxContext["fs"] = {};

    if (cap.mode === "read" || cap.mode === "read_write") {
        api.readFile = async (filePath: string) => {
            validatePath(filePath);
            return fs.readFile(filePath, "utf-8");
        };
        api.readdir = async (dirPath: string) => {
            validatePath(dirPath);
            return fs.readdir(dirPath);
        };
    }

    if (cap.mode === "write" || cap.mode === "read_write") {
        api.writeFile = async (filePath: string, content: string) => {
            validatePath(filePath);
            await fs.writeFile(filePath, content, "utf-8");
        };
    }

    return api;
}

function createChildProcessApi(cap: ChildProcessCapability): SandboxContext["exec"] {
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

function createEnvApi(cap: EnvCapability): SandboxContext["env"] {
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

    constructor(options: SandboxOptions) {
        this.options = {
            memoryLimitMB: options.memoryLimitMB ?? 128,
            timeoutMs: options.timeoutMs ?? 10000,
            capabilities: options.capabilities,
            toolCaller: options.toolCaller
        };
    }

    async execute(code: string, params: Record<string, unknown>): Promise<SandboxResult> {
        this.logs = [];
        this.originalCode = code;

        const context: SandboxContext = {
            params,
            console: {
                log: (...args: any[]) => this.logs.push(`[LOG] ${args.map(a => JSON.stringify(a)).join(" ")}`),
                error: (...args: any[]) => this.logs.push(`[ERROR] ${args.map(a => JSON.stringify(a)).join(" ")}`),
                warn: (...args: any[]) => this.logs.push(`[WARN] ${args.map(a => JSON.stringify(a)).join(" ")}`)
            },
            JSON,
            Math,
            Date,
            Array,
            Object,
            String,
            Number,
            Boolean,
            Promise,
            setTimeout,
            clearTimeout,
            __resolve: () => { },
            __reject: () => { }
        };

        for (const cap of this.options.capabilities) {
            switch (cap.type) {
                case "net":
                    context.fetch = createNetworkApi(cap);
                    break;
                case "fs":
                    context.fs = createFilesystemApi(cap);
                    break;
                case "child_process":
                    context.exec = createChildProcessApi(cap);
                    break;
                case "env":
                    context.env = createEnvApi(cap);
                    break;
            }
        }

        if (this.options.toolCaller) {
            context.callTool = this.options.toolCaller;
        }

        const secretsApi = createSecretsApi();
        (context as any).secrets = secretsApi;

        const wrappedCode = `
            (async () => {
                try {
                    const __result = await (async (params) => {
                        ${code}
                    })(params);
                    __resolve(__result);
                } catch (e) {
                    __reject(e);
                }
            })();
        `;

        try {
            const vmContext = vm.createContext(context);
            const script = new vm.Script(wrappedCode);

            const result = await new Promise<any>((resolve, reject) => {
                context.__resolve = resolve;
                context.__reject = reject;

                const timeoutId = setTimeout(() => {
                    reject(new Error(`Execution timed out after ${this.options.timeoutMs}ms`));
                }, this.options.timeoutMs);

                try {
                    script.runInContext(vmContext, {
                        timeout: this.options.timeoutMs
                    });
                } catch (err) {
                    clearTimeout(timeoutId);
                    reject(err);
                }

                setTimeout(() => clearTimeout(timeoutId), 0);
            });

            return {
                success: true,
                result,
                logs: this.logs
            };
        } catch (error) {
            let message: string;
            if (error instanceof Error) {
                message = formatErrorWithLine(error, this.originalCode);
            } else {
                message = String(error);
            }
            return {
                success: false,
                error: message,
                logs: this.logs
            };
        }
    }

    dispose(): void {
        this.logs = [];
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
