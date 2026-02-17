import { ToolTemplate } from "../types.js";

export const TOOL_TEMPLATES: ToolTemplate[] = [
    {
        id: "api_fetcher",
        name: "API Fetcher",
        description: "Fetch data from a REST API endpoint",
        category: "api",
        schema: {
            type: "object",
            properties: {
                url: { type: "string", description: "API endpoint URL" },
                method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], description: "HTTP method" },
                headers: { type: "object", description: "Request headers" },
                body: { type: "string", description: "Request body (for POST/PUT)" }
            },
            required: ["url"]
        },
        code: `const method = params.method || "GET";
const headers = params.headers || {};
const options = { method, headers };
if (params.body && (method === "POST" || method === "PUT")) {
    options.body = params.body;
}
const response = await fetch(params.url, options);
return response.body;`,
        capabilities: [{ type: "net" }],
        tags: ["http", "rest", "fetch"]
    },
    {
        id: "json_api",
        name: "JSON API Client",
        description: "Fetch and parse JSON from an API",
        category: "api",
        schema: {
            type: "object",
            properties: {
                url: { type: "string", description: "API endpoint URL" },
                query: { type: "object", description: "Query parameters" }
            },
            required: ["url"]
        },
        code: `let url = params.url;
if (params.query) {
    const qs = Object.entries(params.query).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");
    url += (url.includes("?") ? "&" : "?") + qs;
}
const response = await fetch(url, {
    headers: { "Accept": "application/json" }
});
return response.body;`,
        capabilities: [{ type: "net" }],
        tags: ["json", "api", "http"]
    },
    {
        id: "file_reader",
        name: "File Reader",
        description: "Read content from a file",
        category: "file",
        schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Path to the file" }
            },
            required: ["path"]
        },
        code: `const content = await fs.readFile(params.path);
return { content, path: params.path };`,
        capabilities: [{ type: "fs", mode: "read" }],
        tags: ["file", "read", "text"]
    },
    {
        id: "file_writer",
        name: "File Writer",
        description: "Write content to a file",
        category: "file",
        schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Path to the file" },
                content: { type: "string", description: "Content to write" }
            },
            required: ["path", "content"]
        },
        code: `await fs.writeFile(params.path, params.content);
return { success: true, path: params.path, bytesWritten: params.content.length };`,
        capabilities: [{ type: "fs", mode: "write" }],
        tags: ["file", "write", "save"]
    },
    {
        id: "directory_lister",
        name: "Directory Lister",
        description: "List files in a directory",
        category: "file",
        schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Directory path" }
            },
            required: ["path"]
        },
        code: `const files = await fs.readdir(params.path);
return { path: params.path, files, count: files.length };`,
        capabilities: [{ type: "fs", mode: "read" }],
        tags: ["directory", "list", "files"]
    },
    {
        id: "json_transformer",
        name: "JSON Transformer",
        description: "Parse, transform, and format JSON data",
        category: "data",
        schema: {
            type: "object",
            properties: {
                input: { type: "string", description: "JSON string to transform" },
                path: { type: "string", description: "JSON path to extract (dot notation)" }
            },
            required: ["input"]
        },
        code: `const data = JSON.parse(params.input);
if (params.path) {
    const parts = params.path.split(".");
    let result = data;
    for (const part of parts) {
        result = result?.[part];
    }
    return result;
}
return data;`,
        capabilities: [],
        tags: ["json", "parse", "transform"]
    },
    {
        id: "text_processor",
        name: "Text Processor",
        description: "Process and transform text with various operations",
        category: "utility",
        schema: {
            type: "object",
            properties: {
                text: { type: "string", description: "Input text" },
                operation: { type: "string", enum: ["uppercase", "lowercase", "reverse", "wordcount", "linecount", "trim"], description: "Operation to perform" }
            },
            required: ["text", "operation"]
        },
        code: `const ops = {
    uppercase: (t) => t.toUpperCase(),
    lowercase: (t) => t.toLowerCase(),
    reverse: (t) => t.split("").reverse().join(""),
    wordcount: (t) => ({ count: t.split(/\\s+/).filter(Boolean).length }),
    linecount: (t) => ({ count: t.split("\\n").length }),
    trim: (t) => t.trim()
};
const op = ops[params.operation];
if (!op) throw new Error("Unknown operation: " + params.operation);
return op(params.text);`,
        capabilities: [],
        tags: ["text", "string", "transform"]
    },
    {
        id: "shell_command",
        name: "Shell Command Runner",
        description: "Execute a shell command and return output",
        category: "automation",
        schema: {
            type: "object",
            properties: {
                command: { type: "string", description: "Command to execute" },
                args: { type: "array", items: { type: "string" }, description: "Command arguments" }
            },
            required: ["command"]
        },
        code: `const args = params.args || [];
const result = await exec(params.command, args);
return {
    command: params.command,
    args,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.code
};`,
        capabilities: [{ type: "child_process" }],
        tags: ["shell", "command", "exec"]
    },
    {
        id: "env_reader",
        name: "Environment Variable Reader",
        description: "Read environment variables",
        category: "utility",
        schema: {
            type: "object",
            properties: {
                names: { type: "array", items: { type: "string" }, description: "Variable names to read" }
            },
            required: ["names"]
        },
        code: `const result = {};
for (const name of params.names) {
    result[name] = env.get(name) || null;
}
return result;`,
        capabilities: [{ type: "env" }],
        tags: ["env", "environment", "config"]
    },
    {
        id: "data_aggregator",
        name: "Data Aggregator",
        description: "Aggregate array data with various functions",
        category: "data",
        schema: {
            type: "object",
            properties: {
                data: { type: "array", items: { type: "number" }, description: "Array of numbers" },
                operation: { type: "string", enum: ["sum", "avg", "min", "max", "count"], description: "Aggregation operation" }
            },
            required: ["data", "operation"]
        },
        code: `const ops = {
    sum: (arr) => arr.reduce((a, b) => a + b, 0),
    avg: (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
    min: (arr) => Math.min(...arr),
    max: (arr) => Math.max(...arr),
    count: (arr) => arr.length
};
const op = ops[params.operation];
if (!op) throw new Error("Unknown operation: " + params.operation);
return { operation: params.operation, result: op(params.data) };`,
        capabilities: [],
        tags: ["aggregate", "math", "statistics"]
    },
    {
        id: "webhook_caller",
        name: "Webhook Caller",
        description: "Send data to a webhook endpoint",
        category: "integration",
        schema: {
            type: "object",
            properties: {
                url: { type: "string", description: "Webhook URL" },
                payload: { type: "object", description: "JSON payload to send" }
            },
            required: ["url", "payload"]
        },
        code: `const response = await fetch(params.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params.payload)
});
return {
    sent: true,
    status: response.status,
    response: response.body
};`,
        capabilities: [{ type: "net" }],
        tags: ["webhook", "http", "post"]
    },
    {
        id: "timestamp_converter",
        name: "Timestamp Converter",
        description: "Convert between timestamp formats",
        category: "utility",
        schema: {
            type: "object",
            properties: {
                input: { type: "string", description: "Input timestamp or 'now'" },
                outputFormat: { type: "string", enum: ["iso", "unix", "unixMs", "date", "time"], description: "Output format" }
            },
            required: ["input"]
        },
        code: `const date = params.input === "now" ? new Date() : new Date(params.input);
const formats = {
    iso: () => date.toISOString(),
    unix: () => Math.floor(date.getTime() / 1000),
    unixMs: () => date.getTime(),
    date: () => date.toDateString(),
    time: () => date.toTimeString()
};
const format = params.outputFormat || "iso";
const formatter = formats[format];
if (!formatter) throw new Error("Unknown format: " + format);
return { input: params.input, format, result: formatter() };`,
        capabilities: [],
        tags: ["timestamp", "date", "time", "convert"]
    }
];

export function getTemplate(id: string): ToolTemplate | undefined {
    return TOOL_TEMPLATES.find(t => t.id === id);
}

export function listTemplates(category?: string): ToolTemplate[] {
    if (category) {
        return TOOL_TEMPLATES.filter(t => t.category === category);
    }
    return TOOL_TEMPLATES;
}

export function searchTemplates(query: string): ToolTemplate[] {
    const lowerQuery = query.toLowerCase();
    return TOOL_TEMPLATES.filter(t =>
        t.name.toLowerCase().includes(lowerQuery) ||
        t.description.toLowerCase().includes(lowerQuery) ||
        t.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
}

export function formatTemplate(template: ToolTemplate): string {
    return [
        `ID: ${template.id}`,
        `Name: ${template.name}`,
        `Category: ${template.category}`,
        `Description: ${template.description}`,
        `Tags: ${template.tags.join(", ")}`,
        `Capabilities: ${template.capabilities.length > 0 ? template.capabilities.map(c => c.type).join(", ") : "none"}`
    ].join("\n");
}
