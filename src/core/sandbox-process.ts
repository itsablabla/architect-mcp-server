import { createRequire } from "module";
import { fileURLToPath } from "url";
import * as path from "path";
import * as vm from "vm";

const ALLOWED_IMPORTS = new Set([
    "cheerio", "lodash", "date-fns", "xlsx", "nodemailer",
    "marked", "papaparse", "axios", "uuid", "dayjs", "zod"
]);

interface ExecuteMessage {
    type: "execute";
    execId: string;
    code: string;
    params: Record<string, unknown>;
    capabilityTypes: string[];
    imports?: string[];
}

interface CapabilityResponse {
    type: "capability_response";
    execId: string;
    id: string;
    result?: any;
    error?: string;
}

const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let reqCounter = 0;
let activeExecId: string | null = null;

function brokerRequest(execId: string, capType: string, method: string, args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
        const id = `r${reqCounter++}`;
        pending.set(`${execId}:${id}`, { resolve, reject });
        process.send!({ type: "capability_request", execId, id, capType, method, args });
    });
}

function loadImports(imports?: string[]): Record<string, any> {
    if (!imports || imports.length === 0) return {};
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const require = createRequire(path.resolve(__dirname, "../../node_modules"));
    const resolved: Record<string, any> = {};
    for (const pkg of imports) {
        if (!ALLOWED_IMPORTS.has(pkg)) {
            throw new Error(`Package '${pkg}' is not in the allowed imports list. Allowed: ${[...ALLOWED_IMPORTS].join(", ")}`);
        }
        resolved[pkg] = require(pkg);
    }
    return resolved;
}

function buildSandbox(execId: string, capabilityTypes: string[], logs: string[]): Record<string, any> {
    const fmt = (a: any) => { try { return JSON.stringify(a); } catch { return String(a); } };
    const sandbox: Record<string, any> = {
        params: undefined,
        console: {
            log: (...args: any[]) => logs.push(`[LOG] ${args.map(fmt).join(" ")}`),
            error: (...args: any[]) => logs.push(`[ERROR] ${args.map(fmt).join(" ")}`),
            warn: (...args: any[]) => logs.push(`[WARN] ${args.map(fmt).join(" ")}`)
        },
        JSON, Math, Date, Array, Object, String, Number, Boolean, Promise,
        setTimeout, clearTimeout, RegExp, Error, Map, Set, URL, URLSearchParams,
        Buffer, parseInt, parseFloat, isNaN, isFinite,
        encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
        atob: globalThis.atob, btoa: globalThis.btoa
    };

    if (capabilityTypes.includes("net")) {
        sandbox.fetch = (url: string, options?: any) => brokerRequest(execId, "net", "fetch", [url, options]);
    }
    if (capabilityTypes.includes("fs")) {
        sandbox.fs = {
            readFile: (filePath: string) => brokerRequest(execId, "fs", "readFile", [filePath]),
            writeFile: (filePath: string, content: string) => brokerRequest(execId, "fs", "writeFile", [filePath, content]),
            readdir: (dirPath: string) => brokerRequest(execId, "fs", "readdir", [dirPath])
        };
    }
    if (capabilityTypes.includes("child_process")) {
        sandbox.exec = (command: string, args?: string[]) => brokerRequest(execId, "child_process", "exec", [command, args || []]);
    }
    if (capabilityTypes.includes("env")) {
        sandbox.env = { get: (name: string) => brokerRequest(execId, "env", "get", [name]) };
    }
    sandbox.secrets = { get: (name: string) => brokerRequest(execId, "secrets", "get", [name]) };
    sandbox.callTool = (name: string, toolParams: Record<string, unknown>) => brokerRequest(execId, "callTool", "call", [name, toolParams]);

    return sandbox;
}

async function runExecution(msg: ExecuteMessage): Promise<void> {
    const { execId, code, params, capabilityTypes, imports } = msg;
    activeExecId = execId;
    const logs: string[] = [];

    try {
        const sandbox = buildSandbox(execId, capabilityTypes, logs);
        sandbox.params = params;
        Object.assign(sandbox, loadImports(imports));

        const context = vm.createContext(sandbox);
        const script = new vm.Script(`(async function () {\n${code}\n})`);
        const fn = script.runInContext(context);
        const result = await fn();

        send({ type: "result", execId, success: true, result, logs });
    } catch (error) {
        send({ type: "result", execId, success: false, error: error instanceof Error ? error.message : String(error), logs });
    } finally {
        for (const key of pending.keys()) {
            if (key.startsWith(`${execId}:`)) pending.delete(key);
        }
        if (activeExecId === execId) activeExecId = null;
    }
}

function send(payload: any): void {
    try {
        process.send!(payload);
    } catch {
        process.send!({ type: "result", execId: payload.execId, success: false, error: "Result is not serializable", logs: payload.logs ?? [] });
    }
}

process.on("message", (msg: ExecuteMessage | CapabilityResponse) => {
    if (msg.type === "capability_response") {
        const key = `${msg.execId}:${msg.id}`;
        const p = pending.get(key);
        if (p) {
            pending.delete(key);
            if (msg.error) p.reject(new Error(msg.error));
            else p.resolve(msg.result);
        }
        return;
    }
    if (msg.type === "execute") {
        void runExecution(msg);
    }
});

process.send!({ type: "ready" });
