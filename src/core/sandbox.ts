import { fork, ChildProcess } from "child_process";
import { randomUUID } from "crypto";
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
    imports?: string[];
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

type Broker = (capType: string, method: string, args: any[]) => Promise<any>;

interface RunOptions {
    code: string;
    params: Record<string, unknown>;
    capabilityTypes: string[];
    imports: string[];
    timeoutMs: number;
    broker: Broker;
}

interface ActiveExecution {
    execId: string;
    broker: Broker;
    finish: (result: SandboxResult, recycle: boolean) => void;
}

class ChildHandle {
    proc: ChildProcess;
    busy = false;
    execCount = 0;
    dead = false;
    active: ActiveExecution | null = null;
    readonly ready: Promise<void>;

    constructor(scriptPath: string, memoryLimitMB: number, private onExit: (h: ChildHandle) => void) {
        this.proc = fork(scriptPath, [], {
            execArgv: [`--max-old-space-size=${memoryLimitMB}`],
            serialization: "advanced",
            stdio: ["ignore", "ignore", "inherit", "ipc"],
            env: {}
        });

        this.ready = new Promise<void>((resolve) => {
            const onReady = (msg: any) => {
                if (msg && msg.type === "ready") {
                    this.proc.off("message", onReady);
                    resolve();
                }
            };
            this.proc.on("message", onReady);
        });

        this.proc.on("message", (msg: any) => this.handleMessage(msg));
        this.proc.on("exit", () => {
            this.dead = true;
            if (this.active) {
                this.active.finish({ success: false, error: "Sandbox process exited unexpectedly", logs: [] }, true);
            }
            this.onExit(this);
        });
    }

    private handleMessage(msg: any): void {
        if (!this.active || !msg || msg.execId !== this.active.execId) return;

        if (msg.type === "capability_request") {
            const { id, capType, method, args } = msg;
            this.active.broker(capType, method, args)
                .then((result) => this.safeSend({ type: "capability_response", execId: msg.execId, id, result }))
                .catch((err) => this.safeSend({ type: "capability_response", execId: msg.execId, id, error: err instanceof Error ? err.message : String(err) }));
        } else if (msg.type === "result") {
            this.active.finish({ success: msg.success, result: msg.result, error: msg.error, logs: msg.logs || [] }, false);
        }
    }

    private safeSend(payload: any): void {
        if (!this.dead && this.proc.connected) {
            try { this.proc.send(payload); } catch { /* process gone */ }
        }
    }

    send(payload: any): void {
        this.safeSend(payload);
    }

    kill(): void {
        this.dead = true;
        try { this.proc.kill("SIGKILL"); } catch { /* already gone */ }
    }
}

class SandboxPool {
    private idle: ChildHandle[] = [];
    private all = new Set<ChildHandle>();
    private waiters: Array<(h: ChildHandle) => void> = [];
    private readonly scriptPath = path.resolve(__dirname, "sandbox-process.js");

    constructor(
        private maxSize = Number(process.env.ARCHITECT_SANDBOX_POOL ?? 4),
        private maxExecutions = Number(process.env.ARCHITECT_SANDBOX_MAX_EXEC ?? 50),
        private memoryLimitMB = Number(process.env.ARCHITECT_SANDBOX_MEMORY_MB ?? 128)
    ) { }

    private spawn(): ChildHandle {
        const handle = new ChildHandle(this.scriptPath, this.memoryLimitMB, (h) => this.onChildExit(h));
        this.all.add(handle);
        return handle;
    }

    private onChildExit(handle: ChildHandle): void {
        this.all.delete(handle);
        this.idle = this.idle.filter(h => h !== handle);
        this.pump();
    }

    private pump(): void {
        while (this.waiters.length > 0) {
            const handle = this.idle.pop() ?? (this.all.size < this.maxSize ? this.spawn() : null);
            if (!handle) break;
            const waiter = this.waiters.shift()!;
            waiter(handle);
        }
    }

    private acquire(): Promise<ChildHandle> {
        const handle = this.idle.pop() ?? (this.all.size < this.maxSize ? this.spawn() : null);
        if (handle) return Promise.resolve(handle);
        return new Promise<ChildHandle>((resolve) => this.waiters.push(resolve));
    }

    private destroy(handle: ChildHandle): void {
        this.all.delete(handle);
        handle.kill();
        this.pump();
    }

    private releaseIdle(handle: ChildHandle): void {
        if (this.waiters.length > 0) {
            this.waiters.shift()!(handle);
        } else {
            this.idle.push(handle);
        }
    }

    async run(opts: RunOptions): Promise<SandboxResult> {
        const handle = await this.acquire();
        await handle.ready;

        if (handle.dead) {
            return this.run(opts);
        }

        const execId = randomUUID();
        handle.busy = true;
        handle.execCount++;

        return new Promise<SandboxResult>((resolve) => {
            let settled = false;

            const timer = setTimeout(() => finish({ success: false, error: `Execution timed out after ${opts.timeoutMs}ms`, logs: [] }, true), opts.timeoutMs);

            const finish = (result: SandboxResult, recycle: boolean) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                handle.active = null;
                handle.busy = false;
                if (recycle || handle.dead || handle.execCount >= this.maxExecutions) {
                    this.destroy(handle);
                } else {
                    this.releaseIdle(handle);
                }
                resolve(result);
            };

            handle.active = { execId, broker: opts.broker, finish };
            handle.send({
                type: "execute",
                execId,
                code: opts.code,
                params: opts.params,
                capabilityTypes: opts.capabilityTypes,
                imports: opts.imports
            });
        });
    }

    prewarm(count: number): void {
        for (let i = 0; i < count && this.all.size < this.maxSize; i++) {
            this.releaseIdle(this.spawn());
        }
    }

    dispose(): void {
        this.waiters = [];
        for (const handle of this.all) handle.kill();
        this.all.clear();
        this.idle = [];
    }
}

let _pool: SandboxPool | null = null;

function getPool(): SandboxPool {
    if (!_pool) {
        _pool = new SandboxPool();
        _pool.prewarm(2);
    }
    return _pool;
}

export function disposeSandboxPool(): void {
    if (_pool) {
        _pool.dispose();
        _pool = null;
    }
}

export class ToolSandbox {
    private options: SandboxOptions & { memoryLimitMB: number; timeoutMs: number };
    private capabilityHandlers: Map<string, any> = new Map();

    constructor(options: SandboxOptions) {
        this.options = {
            memoryLimitMB: options.memoryLimitMB ?? 128,
            timeoutMs: options.timeoutMs ?? 10000,
            capabilities: options.capabilities,
            toolCaller: options.toolCaller,
            imports: options.imports ?? []
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

    private async handleCapabilityRequest(capType: string, method: string, args: any[]): Promise<any> {
        if (capType === "secrets") {
            const secretsApi = createSecretsApi();
            return secretsApi.get(args[0]);
        }

        if (capType === "callTool") {
            if (!this.options.toolCaller) throw new Error("Tool chaining not available in this context");
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
        return getPool().run({
            code,
            params,
            capabilityTypes: this.options.capabilities.map(c => c.type),
            imports: this.options.imports ?? [],
            timeoutMs: this.options.timeoutMs,
            broker: (capType, method, args) => this.handleCapabilityRequest(capType, method, args)
        });
    }

    dispose(): void {
    }
}

export async function executeInSandbox(
    code: string,
    params: Record<string, unknown>,
    capabilities: Capability[]
): Promise<SandboxResult> {
    const sandbox = new ToolSandbox({ capabilities });
    return sandbox.execute(code, params);
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
