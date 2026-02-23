import { parentPort, workerData } from "worker_threads";

interface WorkerRequest {
    type: "capability_request";
    id: string;
    capType: string;
    method: string;
    args: any[];
}

interface WorkerResponse {
    type: "capability_response";
    id: string;
    result?: any;
    error?: string;
}

const { code, params, capabilityTypes } = workerData as {
    code: string;
    params: Record<string, unknown>;
    capabilityTypes: string[];
};

const logs: string[] = [];
const pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let requestCounter = 0;

function sendCapabilityRequest(capType: string, method: string, args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
        const id = `req_${requestCounter++}`;
        pendingRequests.set(id, { resolve, reject });
        parentPort!.postMessage({
            type: "capability_request",
            id,
            capType,
            method,
            args
        } satisfies WorkerRequest);
    });
}

parentPort!.on("message", (msg: WorkerResponse) => {
    if (msg.type === "capability_response") {
        const pending = pendingRequests.get(msg.id);
        if (pending) {
            pendingRequests.delete(msg.id);
            if (msg.error) {
                pending.reject(new Error(msg.error));
            } else {
                pending.resolve(msg.result);
            }
        }
    }
});

const sandbox: Record<string, any> = {
    params,
    console: {
        log: (...args: any[]) => logs.push(`[LOG] ${args.map(a => { try { return JSON.stringify(a); } catch { return String(a); } }).join(" ")}`),
        error: (...args: any[]) => logs.push(`[ERROR] ${args.map(a => { try { return JSON.stringify(a); } catch { return String(a); } }).join(" ")}`),
        warn: (...args: any[]) => logs.push(`[WARN] ${args.map(a => { try { return JSON.stringify(a); } catch { return String(a); } }).join(" ")}`)
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
    RegExp,
    Error,
    Map,
    Set,
    URL,
    URLSearchParams,
    Buffer,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    atob: globalThis.atob,
    btoa: globalThis.btoa
};

if (capabilityTypes.includes("net")) {
    sandbox.fetch = (url: string, options?: any) =>
        sendCapabilityRequest("net", "fetch", [url, options]);
}

if (capabilityTypes.includes("fs")) {
    sandbox.fs = {
        readFile: (filePath: string) =>
            sendCapabilityRequest("fs", "readFile", [filePath]),
        writeFile: (filePath: string, content: string) =>
            sendCapabilityRequest("fs", "writeFile", [filePath, content]),
        readdir: (dirPath: string) =>
            sendCapabilityRequest("fs", "readdir", [dirPath])
    };
}

if (capabilityTypes.includes("child_process")) {
    sandbox.exec = (command: string, args?: string[]) =>
        sendCapabilityRequest("child_process", "exec", [command, args || []]);
}

if (capabilityTypes.includes("env")) {
    sandbox.env = {
        get: (name: string) =>
            sendCapabilityRequest("env", "get", [name])
    };
}

sandbox.secrets = {
    get: (name: string) =>
        sendCapabilityRequest("secrets", "get", [name])
};

sandbox.callTool = (name: string, toolParams: Record<string, unknown>) =>
    sendCapabilityRequest("callTool", "call", [name, toolParams]);

async function run() {
    try {
        const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
        const argNames = Object.keys(sandbox);
        const argValues = Object.values(sandbox);

        const fn = new AsyncFunction(...argNames, code);
        const result = await fn(...argValues);

        parentPort!.postMessage({
            type: "result",
            success: true,
            result,
            logs
        });
    } catch (error) {
        parentPort!.postMessage({
            type: "result",
            success: false,
            error: error instanceof Error ? error.message : String(error),
            logs
        });
    }
}

run();
