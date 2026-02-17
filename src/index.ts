import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import {
    CustomTool,
    JsonSchema,
    ToolListItem,
    validateToolName,
    jsonSchemaToZod,
    migrateToolData,
    Capability,
    ExportedTool,
    PipelineStep
} from "./types.js";
import {
    parseCapability,
    validateCapabilities,
    formatCapabilities
} from "./core/capabilities.js";
import {
    checkToolApproval,
    approveToolCapabilities,
    revokeToolPermissions,
    listAllPermissions,
    getToolPermissions
} from "./core/permissions.js";
import { ToolSandbox, validateCode } from "./core/sandbox.js";
import { logAudit, getAuditLogs, formatAuditEntry } from "./core/audit.js";
import { recordExecution, checkRateLimit, recordRateLimitCall, getToolStats, getAllStats, formatStats } from "./core/history.js";
import { getTemplate, listTemplates, formatTemplate } from "./tools/templates.js";
import { executeWithRetry } from "./core/retry.js";
import { saveVersion, listVersions, getVersion, diffVersions } from "./tools/versioning.js";
import { runToolTests, formatTestResults } from "./tools/testing.js";
import { createAlias, deleteAlias, getAlias, listAllAliases, resolveAliasParams } from "./tools/aliases.js";
import { executeBatch, formatBatchResult } from "./execution/batch.js";
import { createPipeline, getPipeline, deletePipeline, listAllPipelines, executePipeline, formatPipelineResult } from "./execution/pipelines.js";
import { addSchedule, removeSchedule, listAllSchedules, startScheduler, stopScheduler, formatSchedule } from "./execution/scheduler.js";
import { createWebhook, deleteWebhook, listAllWebhooks, startWebhookServer, stopWebhookServer, formatWebhook } from "./execution/webhooks.js";
import { exportToMarketplace, importFromMarketplace, listMarketplace, deleteFromMarketplace, formatMarketplaceEntry, publishToRemote, browseRemote, installFromRemote, deleteFromRemote } from "./tools/marketplace.js";
import { createResource, getResource, deleteResource, listAllResources, formatResource } from "./mcp/resources.js";
import { createPrompt, getPrompt, deletePrompt, listAllPrompts, renderPrompt, formatPrompt } from "./mcp/prompts.js";
import { getCachedResult, setCachedResult, clearCacheForTool, clearAllCache, getCacheStats, cleanExpiredCache } from "./core/cache.js";
import { setSecret, getSecret, deleteSecret, listSecrets } from "./core/secrets.js";
import { startDashboard, stopDashboard } from "./dashboard/dashboard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUSTOM_TOOLS_DIR = path.resolve(__dirname, "..", "custom_tools");

const server = new McpServer({
    name: "architect-mcp-server",
    version: "1.0.0",
}, {
    capabilities: {
        tools: {
            listChanged: true
        }
    }
});

const registeredTools = new Map<string, CustomTool>();

async function ensureDir(): Promise<void> {
    try {
        await fs.access(CUSTOM_TOOLS_DIR);
    } catch {
        await fs.mkdir(CUSTOM_TOOLS_DIR, { recursive: true });
    }
}

async function getToolFilePath(name: string): Promise<string> {
    return path.join(CUSTOM_TOOLS_DIR, `${name}.json`);
}

async function toolExists(name: string): Promise<boolean> {
    try {
        await fs.access(await getToolFilePath(name));
        return true;
    } catch {
        return false;
    }
}

async function readToolData(name: string): Promise<CustomTool> {
    const filePath = await getToolFilePath(name);
    const content = await fs.readFile(filePath, "utf-8");
    return migrateToolData(JSON.parse(content));
}

async function writeToolData(tool: CustomTool): Promise<void> {
    try {
        const existing = await readToolData(tool.name);
        await saveVersion(tool.name, existing);
    } catch {
    }
    const filePath = await getToolFilePath(tool.name);
    await fs.writeFile(filePath, JSON.stringify(tool, null, 2));
}

async function deleteToolFile(name: string): Promise<void> {
    const filePath = await getToolFilePath(name);
    await fs.unlink(filePath);
}

async function getAllToolFiles(): Promise<string[]> {
    await ensureDir();
    const files = await fs.readdir(CUSTOM_TOOLS_DIR);
    return files.filter(f => f.endsWith(".json"));
}

function createToolResponse(text: string): { content: Array<{ type: "text"; text: string }> } {
    return { content: [{ type: "text", text }] };
}

function createErrorResponse(error: unknown): { content: Array<{ type: "text"; text: string }> } {
    const message = error instanceof Error ? error.message : String(error);
    return createToolResponse(`Error: ${message}`);
}

async function callToolInternal(name: string, params: Record<string, unknown>): Promise<any> {
    const tool = registeredTools.get(name);
    if (!tool) {
        throw new Error(`Tool '${name}' not found or not active`);
    }

    const permission = await getToolPermissions(name);
    const approvedCaps = permission?.approvedCapabilities ?? [];

    const sandbox = new ToolSandbox({
        timeoutMs: 10000,
        capabilities: approvedCaps,
        toolCaller: callToolInternal
    });

    try {
        const result = await sandbox.execute(tool.code, params);
        if (!result.success) {
            throw new Error(result.error);
        }
        return result.result;
    } finally {
        sandbox.dispose();
    }
}

async function registerCustomTool(tool: CustomTool): Promise<void> {
    const zodSchema = jsonSchemaToZod(tool.schema);
    const permission = await getToolPermissions(tool.name);
    const approvedCaps = permission?.approvedCapabilities ?? [];

    server.registerTool(
        tool.name,
        {
            description: tool.description,
            inputSchema: zodSchema,
        },
        async (params: Record<string, unknown>) => {
            const startTime = Date.now();

            if (tool.rateLimit) {
                const rateCheck = await checkRateLimit(tool.name, tool.rateLimit);
                if (!rateCheck.allowed) {
                    await logAudit("tool_execution_failed", tool.name, { reason: rateCheck.reason });
                    return createToolResponse(`Rate limit: ${rateCheck.reason}`);
                }
                await recordRateLimitCall(tool.name);
            }

            if (tool.cache) {
                const cached = await getCachedResult(tool.name, params, tool.cache);
                if (cached !== null) {
                    return createToolResponse(JSON.stringify(cached, null, 2) + "\n\n(cached)");
                }
            }

            const sandbox = new ToolSandbox({
                timeoutMs: 10000,
                capabilities: approvedCaps,
                toolCaller: callToolInternal
            });

            try {
                const executeFn = async () => {
                    const r = await sandbox.execute(tool.code, params);
                    if (!r.success) throw new Error(r.error);
                    return r;
                };

                let result;
                if (tool.retry) {
                    result = await executeWithRetry(executeFn, tool.retry);
                } else {
                    result = await executeFn();
                }

                const duration = Date.now() - startTime;
                await recordExecution(tool.name, true, duration);
                await logAudit("tool_executed", tool.name, {}, duration);

                if (tool.cache) {
                    await setCachedResult(tool.name, params, result.result, tool.cache);
                }

                let output = JSON.stringify(result.result, null, 2);
                if (result.logs.length > 0) {
                    output += `\n\nLogs:\n${result.logs.join("\n")}`;
                }
                return createToolResponse(output);
            } catch (err) {
                const duration = Date.now() - startTime;
                const errorMsg = err instanceof Error ? err.message : String(err);
                await recordExecution(tool.name, false, duration);
                await logAudit("tool_execution_failed", tool.name, { error: errorMsg }, duration);
                return createToolResponse(`Execution Error: ${errorMsg}`);
            } finally {
                sandbox.dispose();
            }
        }
    );

    registeredTools.set(tool.name, tool);
}

async function unregisterCustomTool(name: string): Promise<void> {
    registeredTools.delete(name);
}

async function notifyToolsChanged(): Promise<void> {
    await server.server.notification({
        method: "notifications/tools/list_changed",
    });
}

server.registerTool(
    "create_tool",
    {
        description: "Create a new custom tool definition with optional category, tags, and rate limiting.",
        inputSchema: z.object({
            name: z.string().describe("Unique tool name (lowercase, underscores allowed)"),
            description: z.string().describe("Tool description for LLM"),
            schema: z.string().describe("JSON schema string for input validation"),
            code: z.string().describe("Async JavaScript code with 'params' available"),
            capabilities: z.array(z.string()).default([]).describe("Required capabilities"),
            category: z.enum(["api", "file", "data", "utility", "automation", "integration", "other"]).optional(),
            tags: z.array(z.string()).optional().describe("Tags for organization"),
            dependencies: z.array(z.string()).optional().describe("Names of other tools this tool can call"),
            rate_limit_per_minute: z.number().optional().describe("Max calls per minute"),
            rate_limit_per_hour: z.number().optional().describe("Max calls per hour"),
            author: z.string().optional()
        }),
    },
    async ({ name, description, schema, code, capabilities, category, tags, dependencies, rate_limit_per_minute, rate_limit_per_hour, author }) => {
        try {
            const validation = validateToolName(name);
            if (!validation.valid) {
                return createToolResponse(`Validation Error: ${validation.error}`);
            }

            if (await toolExists(name)) {
                return createToolResponse(`Tool '${name}' already exists. Use update_tool to modify it.`);
            }

            const codeValidation = validateCode(code);
            if (!codeValidation.valid) {
                const lineInfo = codeValidation.line ? ` (line ${codeValidation.line})` : "";
                return createToolResponse(`Syntax Error${lineInfo}: ${codeValidation.error}`);
            }

            await ensureDir();

            let parsedSchema: JsonSchema;
            try {
                parsedSchema = JSON.parse(schema);
            } catch {
                return createToolResponse("Invalid JSON schema provided");
            }

            let parsedCaps: Capability[] = [];
            try {
                parsedCaps = capabilities.map(c => parseCapability(c).capability);
            } catch (err) {
                return createErrorResponse(err);
            }

            const capValidation = validateCapabilities(parsedCaps);
            if (!capValidation.valid) {
                return createToolResponse(`Capability Error: ${capValidation.errors.join(", ")}`);
            }

            if (dependencies) {
                for (const dep of dependencies) {
                    if (!await toolExists(dep) && !registeredTools.has(dep)) {
                        return createToolResponse(`Dependency '${dep}' not found`);
                    }
                }
            }

            const now = new Date().toISOString();
            const tool: CustomTool = {
                name,
                description,
                schema: parsedSchema,
                code,
                createdAt: now,
                updatedAt: now,
                version: 1,
                capabilities: parsedCaps,
                category: category || "other",
                tags: tags || [],
                dependencies: dependencies || [],
                author
            };

            if (rate_limit_per_minute || rate_limit_per_hour) {
                tool.rateLimit = {
                    maxCallsPerMinute: rate_limit_per_minute || 60,
                    maxCallsPerHour: rate_limit_per_hour || 1000
                };
            }

            await writeToolData(tool);
            await logAudit("tool_created", name, { version: 1, category, capabilities: parsedCaps.length });

            let response = `Tool '${name}' created (v1).`;
            if (parsedCaps.length > 0) {
                response += `\n\nRequested capabilities:\n${formatCapabilities(parsedCaps)}`;
                response += `\n\nRun 'approve_tool' then 'save_tool' to activate.`;
            } else {
                response += ` Run 'save_tool' to activate.`;
            }

            return createToolResponse(response);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "update_tool",
    {
        description: "Update an existing custom tool.",
        inputSchema: z.object({
            name: z.string(),
            description: z.string().optional(),
            schema: z.string().optional(),
            code: z.string().optional(),
            capabilities: z.array(z.string()).optional(),
            category: z.enum(["api", "file", "data", "utility", "automation", "integration", "other"]).optional(),
            tags: z.array(z.string()).optional(),
            dependencies: z.array(z.string()).optional(),
            rate_limit_per_minute: z.number().optional(),
            rate_limit_per_hour: z.number().optional()
        }),
    },
    async ({ name, description, schema, code, capabilities, category, tags, dependencies, rate_limit_per_minute, rate_limit_per_hour }) => {
        try {
            if (!await toolExists(name)) {
                return createToolResponse(`Tool '${name}' not found.`);
            }

            const existing = await readToolData(name);

            if (code) {
                const codeValidation = validateCode(code);
                if (!codeValidation.valid) {
                    const lineInfo = codeValidation.line ? ` (line ${codeValidation.line})` : "";
                    return createToolResponse(`Syntax Error${lineInfo}: ${codeValidation.error}`);
                }
            }

            let parsedSchema = existing.schema;
            if (schema) {
                try {
                    parsedSchema = JSON.parse(schema);
                } catch {
                    return createToolResponse("Invalid JSON schema provided");
                }
            }

            let parsedCaps = existing.capabilities;
            if (capabilities) {
                try {
                    parsedCaps = capabilities.map(c => parseCapability(c).capability);
                } catch (err) {
                    return createErrorResponse(err);
                }
            }

            const updated: CustomTool = {
                ...existing,
                description: description ?? existing.description,
                schema: parsedSchema,
                code: code ?? existing.code,
                updatedAt: new Date().toISOString(),
                version: existing.version + 1,
                capabilities: parsedCaps,
                category: category ?? existing.category,
                tags: tags ?? existing.tags,
                dependencies: dependencies ?? existing.dependencies
            };

            if (rate_limit_per_minute !== undefined || rate_limit_per_hour !== undefined) {
                updated.rateLimit = {
                    maxCallsPerMinute: rate_limit_per_minute ?? existing.rateLimit?.maxCallsPerMinute ?? 60,
                    maxCallsPerHour: rate_limit_per_hour ?? existing.rateLimit?.maxCallsPerHour ?? 1000
                };
            }

            await writeToolData(updated);
            await logAudit("tool_updated", name, { version: updated.version });

            if (registeredTools.has(name)) {
                const { approved, missing } = await checkToolApproval(updated);
                if (!approved) {
                    await unregisterCustomTool(name);
                    await notifyToolsChanged();
                    return createToolResponse(
                        `Tool '${name}' updated to v${updated.version} but deactivated.\n\n` +
                        `New capabilities require approval:\n${formatCapabilities(missing)}`
                    );
                }

                await registerCustomTool(updated);
                await notifyToolsChanged();
                return createToolResponse(`Tool '${name}' updated to v${updated.version} and reloaded.`);
            }

            return createToolResponse(`Tool '${name}' updated to v${updated.version}.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "validate_tool",
    {
        description: "Validate tool code syntax without creating the tool.",
        inputSchema: z.object({
            code: z.string().describe("JavaScript code to validate")
        }),
    },
    async ({ code }) => {
        const result = validateCode(code);
        if (result.valid) {
            return createToolResponse("Code syntax is valid.");
        }
        const lineInfo = result.line ? ` (line ${result.line})` : "";
        return createToolResponse(`Syntax Error${lineInfo}: ${result.error}`);
    }
);

server.registerTool(
    "save_tool",
    {
        description: "Activate a tool from the registry.",
        inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => {
        try {
            if (!await toolExists(name)) {
                return createToolResponse(`Tool '${name}' not found.`);
            }

            const tool = await readToolData(name);
            const { approved, missing } = await checkToolApproval(tool);

            if (!approved) {
                return createToolResponse(
                    `Tool '${name}' requires unapproved capabilities:\n${formatCapabilities(missing)}\n\n` +
                    `Run 'approve_tool' first.`
                );
            }

            await registerCustomTool(tool);
            await notifyToolsChanged();
            await logAudit("tool_activated", name, { version: tool.version });

            return createToolResponse(`Tool '${name}' (v${tool.version}) activated.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "approve_tool",
    {
        description: "Approve capabilities for a custom tool.",
        inputSchema: z.object({
            name: z.string(),
            capabilities: z.array(z.string()).optional()
        }),
    },
    async ({ name, capabilities }) => {
        try {
            if (!await toolExists(name)) {
                return createToolResponse(`Tool '${name}' not found.`);
            }

            const tool = await readToolData(name);

            if (tool.capabilities.length === 0) {
                return createToolResponse(`Tool '${name}' requires no capabilities. Use 'save_tool' directly.`);
            }

            let toApprove: Capability[];
            if (capabilities && capabilities.length > 0) {
                toApprove = capabilities.map(c => parseCapability(c).capability);
            } else {
                toApprove = tool.capabilities;
            }

            await approveToolCapabilities(tool.name, tool.version, toApprove);
            await logAudit("permissions_approved", name, { capabilities: toApprove.length });

            return createToolResponse(
                `Approved for '${name}' (v${tool.version}):\n${formatCapabilities(toApprove)}\n\n` +
                `Run 'save_tool' to activate.`
            );
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "revoke_permissions",
    {
        description: "Revoke permissions for a tool.",
        inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => {
        try {
            const existing = await getToolPermissions(name);
            if (!existing) {
                return createToolResponse(`No permissions for '${name}'.`);
            }

            await revokeToolPermissions(name);
            await logAudit("permissions_revoked", name);

            if (registeredTools.has(name)) {
                await unregisterCustomTool(name);
                await notifyToolsChanged();
                return createToolResponse(`Permissions revoked, tool deactivated.`);
            }

            return createToolResponse(`Permissions revoked for '${name}'.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "list_permissions",
    {
        description: "List all tool permissions.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const permissions = await listAllPermissions();
            if (permissions.length === 0) {
                return createToolResponse("No permissions configured.");
            }

            const output = permissions.map(p => {
                const status = registeredTools.has(p.toolName) ? "[ACTIVE]" : "[INACTIVE]";
                return `${status} ${p.toolName} (v${p.toolVersion})\n${formatCapabilities(p.approvedCapabilities)}`;
            }).join("\n\n");

            return createToolResponse(`Permissions (${permissions.length}):\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "delete_tool",
    {
        description: "Delete a custom tool.",
        inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => {
        try {
            if (!await toolExists(name)) {
                return createToolResponse(`Tool '${name}' not found.`);
            }

            await deleteToolFile(name);
            await unregisterCustomTool(name);

            if (await getToolPermissions(name)) {
                await revokeToolPermissions(name);
            }

            await notifyToolsChanged();
            await logAudit("tool_deleted", name);

            return createToolResponse(`Tool '${name}' deleted.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "list_tools",
    {
        description: "List custom tools with filtering.",
        inputSchema: z.object({
            active_only: z.boolean().optional(),
            category: z.enum(["api", "file", "data", "utility", "automation", "integration", "other"]).optional(),
            tag: z.string().optional()
        }),
    },
    async ({ active_only, category, tag }) => {
        try {
            const files = await getAllToolFiles();
            if (files.length === 0) {
                return createToolResponse("No custom tools found.");
            }

            let tools: ToolListItem[] = [];

            for (const file of files) {
                const name = file.replace(".json", "");
                if (active_only && !registeredTools.has(name)) continue;

                try {
                    const tool = await readToolData(name);
                    if (category && tool.category !== category) continue;
                    if (tag && !tool.tags?.includes(tag)) continue;

                    tools.push({
                        name: tool.name,
                        description: tool.description,
                        version: tool.version,
                        createdAt: tool.createdAt,
                        updatedAt: tool.updatedAt,
                        capabilities: tool.capabilities,
                        category: tool.category,
                        tags: tool.tags
                    });
                } catch { continue; }
            }

            if (tools.length === 0) {
                return createToolResponse("No matching tools found.");
            }

            const output = tools.map(t => {
                const status = registeredTools.has(t.name) ? "[ACTIVE]" : "[INACTIVE]";
                const cat = t.category ? `[${t.category}]` : "";
                const tags = t.tags?.length ? ` #${t.tags.join(" #")}` : "";
                return `${status} ${t.name} (v${t.version}) ${cat}${tags}\n  ${t.description}`;
            }).join("\n\n");

            return createToolResponse(`Tools (${tools.length}):\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "get_tool_source",
    {
        description: "Get tool source code and details.",
        inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => {
        try {
            if (!await toolExists(name)) {
                return createToolResponse(`Tool '${name}' not found.`);
            }

            const tool = await readToolData(name);
            const status = registeredTools.has(name) ? "ACTIVE" : "INACTIVE";

            const output = [
                `Tool: ${tool.name} (v${tool.version}) [${status}]`,
                `Category: ${tool.category || "other"}`,
                `Tags: ${tool.tags?.join(", ") || "none"}`,
                `Dependencies: ${tool.dependencies?.join(", ") || "none"}`,
                `Description: ${tool.description}`,
                `Created: ${tool.createdAt}`,
                `Updated: ${tool.updatedAt}`,
                tool.rateLimit ? `Rate Limit: ${tool.rateLimit.maxCallsPerMinute}/min, ${tool.rateLimit.maxCallsPerHour}/hr` : "",
                "",
                "Capabilities:",
                formatCapabilities(tool.capabilities),
                "",
                "Schema:",
                JSON.stringify(tool.schema, null, 2),
                "",
                "Code:",
                tool.code
            ].filter(Boolean).join("\n");

            return createToolResponse(output);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "get_tool_stats",
    {
        description: "Get execution statistics for a tool.",
        inputSchema: z.object({
            name: z.string().optional().describe("Tool name, or omit for all tools")
        }),
    },
    async ({ name }) => {
        try {
            if (name) {
                const stats = await getToolStats(name);
                if (!stats) {
                    return createToolResponse(`No stats for '${name}'.`);
                }
                return createToolResponse(`Stats for '${name}':\n\n${formatStats(stats)}`);
            }

            const allStats = await getAllStats();
            if (Object.keys(allStats).length === 0) {
                return createToolResponse("No execution stats yet.");
            }

            const output = Object.entries(allStats)
                .map(([n, s]) => `${n}:\n${formatStats(s)}`)
                .join("\n\n");

            return createToolResponse(`All Tool Stats:\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "export_tool",
    {
        description: "Export a tool as JSON.",
        inputSchema: z.object({
            name: z.string(),
            include_permissions: z.boolean().default(true)
        }),
    },
    async ({ name, include_permissions }) => {
        try {
            if (!await toolExists(name)) {
                return createToolResponse(`Tool '${name}' not found.`);
            }

            const tool = await readToolData(name);
            const exported: ExportedTool = {
                formatVersion: 1,
                exportedAt: new Date().toISOString(),
                tool
            };

            if (include_permissions) {
                const perm = await getToolPermissions(name);
                if (perm) exported.permissions = perm;
            }

            await logAudit("tool_exported", name);
            return createToolResponse(JSON.stringify(exported, null, 2));
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "import_tool",
    {
        description: "Import a tool from JSON.",
        inputSchema: z.object({
            json: z.string().describe("Exported tool JSON"),
            overwrite: z.boolean().default(false)
        }),
    },
    async ({ json, overwrite }) => {
        try {
            const data = JSON.parse(json) as ExportedTool;
            if (!data.tool || !data.tool.name) {
                return createToolResponse("Invalid export format.");
            }

            const name = data.tool.name;
            if (await toolExists(name) && !overwrite) {
                return createToolResponse(`Tool '${name}' exists. Use overwrite=true.`);
            }

            const tool = migrateToolData(data.tool);
            tool.updatedAt = new Date().toISOString();

            await writeToolData(tool);

            if (data.permissions) {
                await approveToolCapabilities(
                    name,
                    data.permissions.toolVersion,
                    data.permissions.approvedCapabilities
                );
            }

            await logAudit("tool_imported", name);
            return createToolResponse(`Tool '${name}' imported successfully.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "list_templates",
    {
        description: "List available tool templates.",
        inputSchema: z.object({
            category: z.enum(["api", "file", "data", "utility", "automation", "integration", "other"]).optional()
        }),
    },
    async ({ category }) => {
        const templates = listTemplates(category);
        if (templates.length === 0) {
            return createToolResponse("No templates found.");
        }

        const output = templates.map(t => formatTemplate(t)).join("\n\n");
        return createToolResponse(`Templates (${templates.length}):\n\n${output}`);
    }
);

server.registerTool(
    "create_from_template",
    {
        description: "Create a tool from a template.",
        inputSchema: z.object({
            template_id: z.string(),
            name: z.string().describe("Name for the new tool"),
            customize: z.object({
                description: z.string().optional(),
                capabilities: z.array(z.string()).optional()
            }).optional()
        }),
    },
    async ({ template_id, name, customize }) => {
        try {
            const template = getTemplate(template_id);
            if (!template) {
                return createToolResponse(`Template '${template_id}' not found.`);
            }

            const validation = validateToolName(name);
            if (!validation.valid) {
                return createToolResponse(`Validation Error: ${validation.error}`);
            }

            if (await toolExists(name)) {
                return createToolResponse(`Tool '${name}' already exists.`);
            }

            let caps = template.capabilities;
            if (customize?.capabilities) {
                caps = customize.capabilities.map(c => parseCapability(c).capability);
            }

            const now = new Date().toISOString();
            const tool: CustomTool = {
                name,
                description: customize?.description || template.description,
                schema: template.schema,
                code: template.code,
                createdAt: now,
                updatedAt: now,
                version: 1,
                capabilities: caps,
                category: template.category,
                tags: [...template.tags]
            };

            await ensureDir();
            await writeToolData(tool);
            await logAudit("tool_created", name, { template: template_id });

            let response = `Tool '${name}' created from template '${template_id}'.`;
            if (caps.length > 0) {
                response += `\n\nCapabilities:\n${formatCapabilities(caps)}\n\nRun 'approve_tool' then 'save_tool'.`;
            } else {
                response += ` Run 'save_tool' to activate.`;
            }

            return createToolResponse(response);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "get_audit_logs",
    {
        description: "Get audit logs.",
        inputSchema: z.object({
            tool_name: z.string().optional(),
            action: z.string().optional(),
            limit: z.number().default(50)
        }),
    },
    async ({ tool_name, action, limit }) => {
        try {
            const logs = await getAuditLogs({
                toolName: tool_name,
                action: action as any,
                limit
            });

            if (logs.length === 0) {
                return createToolResponse("No audit logs found.");
            }

            const output = logs.map(formatAuditEntry).join("\n");
            return createToolResponse(`Audit Logs (${logs.length}):\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "reload_tools",
    {
        description: "Reload all approved tools.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const files = await getAllToolFiles();
            let loaded = 0, skipped = 0, failed = 0;

            for (const file of files) {
                const name = file.replace(".json", "");
                try {
                    const tool = await readToolData(name);
                    const { approved } = await checkToolApproval(tool);
                    if (!approved) { skipped++; continue; }
                    await registerCustomTool(tool);
                    loaded++;
                } catch { failed++; }
            }

            await notifyToolsChanged();
            return createToolResponse(`Loaded: ${loaded}, Skipped: ${skipped}, Failed: ${failed}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "list_versions",
    {
        description: "List version history for a tool.",
        inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => {
        try {
            const versions = await listVersions(name);
            if (versions.length === 0) {
                return createToolResponse(`No versions found for '${name}'.`);
            }

            const output = versions.map(v =>
                `v${v.version} - saved at ${v.savedAt}`
            ).join("\n");

            return createToolResponse(`Versions for '${name}' (${versions.length}):\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "rollback_tool",
    {
        description: "Rollback a tool to a previous version.",
        inputSchema: z.object({
            name: z.string(),
            version: z.number().describe("Version number to rollback to")
        }),
    },
    async ({ name, version }) => {
        try {
            const oldTool = await getVersion(name, version);
            if (!oldTool) {
                return createToolResponse(`Version ${version} not found for '${name}'.`);
            }

            oldTool.updatedAt = new Date().toISOString();
            oldTool.version = (await readToolData(name)).version + 1;

            await writeToolData(oldTool);
            await logAudit("version_rolled_back", name, { fromVersion: version, toVersion: oldTool.version });

            if (registeredTools.has(name)) {
                const { approved } = await checkToolApproval(oldTool);
                if (approved) {
                    await registerCustomTool(oldTool);
                    await notifyToolsChanged();
                }
            }

            return createToolResponse(`Tool '${name}' rolled back to v${version} (now v${oldTool.version}).`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "diff_versions",
    {
        description: "Compare two versions of a tool.",
        inputSchema: z.object({
            name: z.string(),
            v1: z.number(),
            v2: z.number()
        }),
    },
    async ({ name, v1, v2 }) => {
        try {
            const diffs = await diffVersions(name, v1, v2);
            if (diffs.length === 0) {
                return createToolResponse(`No differences between v${v1} and v${v2}.`);
            }

            const output = diffs.map(d =>
                `${d.field}:\n  v${v1}: ${JSON.stringify(d.v1Value)}\n  v${v2}: ${JSON.stringify(d.v2Value)}`
            ).join("\n\n");

            return createToolResponse(`Diff v${v1} vs v${v2} for '${name}':\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "set_secret",
    {
        description: "Store an encrypted secret.",
        inputSchema: z.object({
            name: z.string().describe("Secret name"),
            value: z.string().describe("Secret value to encrypt")
        }),
    },
    async ({ name, value }) => {
        try {
            await setSecret(name, value);
            await logAudit("secret_set", name);
            return createToolResponse(`Secret '${name}' stored.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "get_secret",
    {
        description: "Retrieve a decrypted secret.",
        inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => {
        try {
            const value = await getSecret(name);
            if (value === null) {
                return createToolResponse(`Secret '${name}' not found.`);
            }
            return createToolResponse(`Secret '${name}': ${value}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "delete_secret",
    {
        description: "Delete a stored secret.",
        inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => {
        try {
            const deleted = await deleteSecret(name);
            if (!deleted) {
                return createToolResponse(`Secret '${name}' not found.`);
            }
            await logAudit("secret_deleted", name);
            return createToolResponse(`Secret '${name}' deleted.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "list_secrets",
    {
        description: "List all stored secret names.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const secrets = await listSecrets();
            if (secrets.length === 0) {
                return createToolResponse("No secrets stored.");
            }
            const output = secrets.map(s => `${s.name} (updated: ${s.updatedAt})`).join("\n");
            return createToolResponse(`Secrets (${secrets.length}):\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "clear_cache",
    {
        description: "Clear cached results.",
        inputSchema: z.object({
            tool_name: z.string().optional().describe("Clear cache for specific tool, or all if omitted")
        }),
    },
    async ({ tool_name }) => {
        try {
            let cleared: number;
            if (tool_name) {
                cleared = await clearCacheForTool(tool_name);
            } else {
                cleared = await clearAllCache();
            }
            await logAudit("cache_cleared", tool_name || "all");
            return createToolResponse(`Cleared ${cleared} cache entries.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "cache_stats",
    {
        description: "Get cache statistics.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const stats = await getCacheStats();
            return createToolResponse(JSON.stringify(stats, null, 2));
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "run_tests",
    {
        description: "Run tests for a tool.",
        inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => {
        try {
            if (!await toolExists(name)) {
                return createToolResponse(`Tool '${name}' not found.`);
            }

            const tool = await readToolData(name);
            if (!tool.tests || tool.tests.length === 0) {
                return createToolResponse(`Tool '${name}' has no tests defined.`);
            }

            const result = await runToolTests(tool, {
                toolCaller: callToolInternal
            });

            await logAudit("tests_run", name, { passed: result.passed, failed: result.failed });
            return createToolResponse(formatTestResults(result));
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "create_alias",
    {
        description: "Create an alias for a tool with preset parameters.",
        inputSchema: z.object({
            alias: z.string().describe("Alias name"),
            target_tool: z.string().describe("Target tool name"),
            preset_params: z.string().default("{}").describe("JSON preset parameters"),
            description: z.string().optional()
        }),
    },
    async ({ alias, target_tool, preset_params, description }) => {
        try {
            if (!await toolExists(target_tool) && !registeredTools.has(target_tool)) {
                return createToolResponse(`Target tool '${target_tool}' not found.`);
            }

            let params: Record<string, unknown>;
            try {
                params = JSON.parse(preset_params);
            } catch {
                return createToolResponse("Invalid preset_params JSON.");
            }

            const entry = await createAlias(alias, target_tool, params, description);
            await logAudit("alias_created", alias, { targetTool: target_tool });
            return createToolResponse(`Alias '${entry.alias}' -> '${entry.targetTool}' created.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "delete_alias",
    {
        description: "Delete a tool alias.",
        inputSchema: z.object({ alias: z.string() }),
    },
    async ({ alias }) => {
        try {
            const deleted = await deleteAlias(alias);
            if (!deleted) {
                return createToolResponse(`Alias '${alias}' not found.`);
            }
            await logAudit("alias_deleted", alias);
            return createToolResponse(`Alias '${alias}' deleted.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "list_aliases",
    {
        description: "List all tool aliases.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const aliases = await listAllAliases();
            if (aliases.length === 0) {
                return createToolResponse("No aliases defined.");
            }
            const output = aliases.map(a =>
                `${a.alias} -> ${a.targetTool}${a.description ? ` (${a.description})` : ""}\n  Preset: ${JSON.stringify(a.presetParams)}`
            ).join("\n\n");
            return createToolResponse(`Aliases (${aliases.length}):\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "execute_alias",
    {
        description: "Execute a tool through its alias.",
        inputSchema: z.object({
            alias: z.string(),
            params: z.string().default("{}").describe("JSON parameters to merge with preset")
        }),
    },
    async ({ alias, params }) => {
        try {
            const aliasEntry = await getAlias(alias);
            if (!aliasEntry) {
                return createToolResponse(`Alias '${alias}' not found.`);
            }

            let inputParams: Record<string, unknown>;
            try {
                inputParams = JSON.parse(params);
            } catch {
                return createToolResponse("Invalid params JSON.");
            }

            const mergedParams = resolveAliasParams(aliasEntry, inputParams);
            const result = await callToolInternal(aliasEntry.targetTool, mergedParams);
            return createToolResponse(JSON.stringify(result, null, 2));
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "batch_execute",
    {
        description: "Execute a tool with multiple inputs in parallel.",
        inputSchema: z.object({
            tool_name: z.string(),
            inputs: z.string().describe("JSON array of input objects"),
            concurrency: z.number().default(5).describe("Max parallel executions")
        }),
    },
    async ({ tool_name, inputs, concurrency }) => {
        try {
            let parsedInputs: Record<string, unknown>[];
            try {
                parsedInputs = JSON.parse(inputs);
            } catch {
                return createToolResponse("Invalid inputs JSON array.");
            }

            if (!Array.isArray(parsedInputs)) {
                return createToolResponse("Inputs must be a JSON array.");
            }

            const result = await executeBatch(
                tool_name,
                parsedInputs,
                concurrency,
                (params) => callToolInternal(tool_name, params)
            );

            await logAudit("batch_executed", tool_name, {
                total: result.results.length,
                success: result.successCount,
                failed: result.failCount
            });

            return createToolResponse(formatBatchResult(result));
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "create_pipeline",
    {
        description: "Create a tool execution pipeline.",
        inputSchema: z.object({
            name: z.string(),
            description: z.string(),
            steps: z.string().describe("JSON array of pipeline steps [{tool, params, outputAs?, condition?}]")
        }),
    },
    async ({ name, description, steps }) => {
        try {
            let parsedSteps: PipelineStep[];
            try {
                parsedSteps = JSON.parse(steps);
            } catch {
                return createToolResponse("Invalid steps JSON.");
            }

            const pipeline = await createPipeline(name, description, parsedSteps);
            await logAudit("pipeline_created", name, { steps: parsedSteps.length });
            return createToolResponse(`Pipeline '${name}' created with ${parsedSteps.length} steps.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "execute_pipeline",
    {
        description: "Execute a pipeline.",
        inputSchema: z.object({
            name: z.string(),
            input: z.string().default("{}").describe("JSON initial input")
        }),
    },
    async ({ name, input }) => {
        try {
            const pipeline = await getPipeline(name);
            if (!pipeline) {
                return createToolResponse(`Pipeline '${name}' not found.`);
            }

            let initialInput: Record<string, unknown>;
            try {
                initialInput = JSON.parse(input);
            } catch {
                return createToolResponse("Invalid input JSON.");
            }

            const result = await executePipeline(pipeline, callToolInternal, initialInput);
            await logAudit("pipeline_executed", name, {
                success: result.success,
                steps: result.steps.length
            });

            return createToolResponse(formatPipelineResult(result));
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "delete_pipeline",
    {
        description: "Delete a pipeline.",
        inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => {
        try {
            const deleted = await deletePipeline(name);
            if (!deleted) {
                return createToolResponse(`Pipeline '${name}' not found.`);
            }
            await logAudit("pipeline_deleted", name);
            return createToolResponse(`Pipeline '${name}' deleted.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "list_pipelines",
    {
        description: "List all pipelines.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const pipelines = await listAllPipelines();
            if (pipelines.length === 0) {
                return createToolResponse("No pipelines defined.");
            }
            const output = pipelines.map(p =>
                `${p.name} - ${p.description} (${p.steps.length} steps)`
            ).join("\n");
            return createToolResponse(`Pipelines (${pipelines.length}):\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "create_schedule",
    {
        description: "Create a cron schedule for a tool.",
        inputSchema: z.object({
            tool_name: z.string(),
            cron: z.string().describe("Cron expression (e.g. '*/5 * * * *')"),
            params: z.string().default("{}").describe("JSON tool parameters")
        }),
    },
    async ({ tool_name, cron, params }) => {
        try {
            let parsedParams: Record<string, unknown>;
            try {
                parsedParams = JSON.parse(params);
            } catch {
                return createToolResponse("Invalid params JSON.");
            }

            const schedule = await addSchedule({
                toolName: tool_name,
                cron,
                params: parsedParams
            });

            await logAudit("schedule_created", tool_name, { scheduleId: schedule.id, cron });
            return createToolResponse(`Schedule created:\n${formatSchedule(schedule)}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "delete_schedule",
    {
        description: "Delete a schedule.",
        inputSchema: z.object({ id: z.string() }),
    },
    async ({ id }) => {
        try {
            const deleted = await removeSchedule(id);
            if (!deleted) {
                return createToolResponse(`Schedule '${id}' not found.`);
            }
            await logAudit("schedule_deleted", id);
            return createToolResponse(`Schedule '${id}' deleted.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "list_schedules",
    {
        description: "List all schedules.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const schedules = await listAllSchedules();
            if (schedules.length === 0) {
                return createToolResponse("No schedules configured.");
            }
            const output = schedules.map(formatSchedule).join("\n\n");
            return createToolResponse(`Schedules (${schedules.length}):\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "create_webhook",
    {
        description: "Create a webhook that triggers a tool.",
        inputSchema: z.object({
            tool_name: z.string(),
            path: z.string().describe("Webhook path (e.g. '/my-hook')"),
            method: z.enum(["GET", "POST"]).default("POST"),
            secret: z.string().optional().describe("Optional webhook secret for authentication")
        }),
    },
    async ({ tool_name, path: webhookPath, method, secret }) => {
        try {
            const webhook = await createWebhook({
                toolName: tool_name,
                path: webhookPath,
                method,
                secret
            });

            await logAudit("webhook_created", tool_name, { webhookId: webhook.id, path: webhookPath });
            return createToolResponse(`Webhook created:\n${formatWebhook(webhook)}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "delete_webhook",
    {
        description: "Delete a webhook.",
        inputSchema: z.object({ id: z.string() }),
    },
    async ({ id }) => {
        try {
            const deleted = await deleteWebhook(id);
            if (!deleted) {
                return createToolResponse(`Webhook '${id}' not found.`);
            }
            await logAudit("webhook_deleted", id);
            return createToolResponse(`Webhook '${id}' deleted.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "list_webhooks",
    {
        description: "List all webhooks.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const webhooks = await listAllWebhooks();
            if (webhooks.length === 0) {
                return createToolResponse("No webhooks configured.");
            }
            const output = webhooks.map(formatWebhook).join("\n\n");
            return createToolResponse(`Webhooks (${webhooks.length}):\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "marketplace_export",
    {
        description: "Export a tool to the local marketplace.",
        inputSchema: z.object({
            name: z.string(),
            author: z.string().describe("Author name")
        }),
    },
    async ({ name, author }) => {
        try {
            if (!await toolExists(name)) {
                return createToolResponse(`Tool '${name}' not found.`);
            }

            const tool = await readToolData(name);
            const entry = await exportToMarketplace(tool, author);
            await logAudit("marketplace_exported", name, { marketplaceId: entry.id });
            return createToolResponse(`Exported to marketplace:\n${formatMarketplaceEntry(entry)}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "marketplace_import",
    {
        description: "Import a tool from the marketplace.",
        inputSchema: z.object({
            id: z.string().describe("Marketplace entry ID"),
            overwrite: z.boolean().default(false)
        }),
    },
    async ({ id, overwrite }) => {
        try {
            const exported = await importFromMarketplace(id);
            if (!exported) {
                return createToolResponse(`Marketplace entry '${id}' not found.`);
            }

            const name = exported.tool.name;
            if (await toolExists(name) && !overwrite) {
                return createToolResponse(`Tool '${name}' exists. Use overwrite=true.`);
            }

            const tool = migrateToolData(exported.tool);
            tool.updatedAt = new Date().toISOString();
            await writeToolData(tool);
            await logAudit("marketplace_imported", name, { marketplaceId: id });
            return createToolResponse(`Tool '${name}' imported from marketplace.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "marketplace_list",
    {
        description: "List marketplace entries.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const entries = await listMarketplace();
            if (entries.length === 0) {
                return createToolResponse("Marketplace is empty.");
            }
            const output = entries.map(formatMarketplaceEntry).join("\n\n");
            return createToolResponse(`Marketplace (${entries.length}):\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "marketplace_delete",
    {
        description: "Delete a tool from the local marketplace.",
        inputSchema: z.object({
            id: z.string().describe("Marketplace entry ID to delete")
        }),
    },
    async ({ id }) => {
        try {
            const deleted = await deleteFromMarketplace(id);
            if (!deleted) {
                return createToolResponse(`Marketplace entry '${id}' not found.`);
            }
            await logAudit("marketplace_exported", id, { action: "deleted" });
            return createToolResponse(`Marketplace entry '${id}' deleted.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "marketplace_publish",
    {
        description: "Publish a tool to the remote GitHub marketplace. Ownership is tied to your GitHub token — only you can update or delete tools you publish. Ensure the tool uses secrets.get() for credentials and does not contain hardcoded API keys.",
        inputSchema: z.object({
            name: z.string().describe("Tool name to publish"),
            author: z.string().describe("Author name")
        }),
    },
    async ({ name, author }) => {
        try {
            const token = await getSecret("GITHUB_TOKEN");
            if (!token) {
                return createToolResponse("GitHub token not set. Use set_secret with name 'GITHUB_TOKEN'.");
            }

            if (!await toolExists(name)) {
                return createToolResponse(`Tool '${name}' not found.`);
            }

            const tool = await readToolData(name);
            const entry = await publishToRemote(tool, author, token);
            await logAudit("marketplace_published", name, { author });
            return createToolResponse(`Published to remote marketplace:\n${formatMarketplaceEntry(entry)}\n\nURL: https://github.com/ageborn-dev/architect-mcp-marketplace/blob/main/tools/${name}.json`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "marketplace_browse",
    {
        description: "Browse tools on the remote GitHub marketplace.",
        inputSchema: z.object({
            query: z.string().optional().describe("Search by name, description, or tags"),
            category: z.enum(["api", "file", "data", "utility", "automation", "integration", "other"]).optional()
        }),
    },
    async ({ query, category }) => {
        try {
            const token = await getSecret("GITHUB_TOKEN");
            if (!token) {
                return createToolResponse("GitHub token not set. Use set_secret with name 'GITHUB_TOKEN'.");
            }

            const entries = await browseRemote(token, query, category);
            if (entries.length === 0) {
                return createToolResponse("No tools found on remote marketplace.");
            }
            const output = entries.map(formatMarketplaceEntry).join("\n\n");
            return createToolResponse(`Remote Marketplace (${entries.length}):\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "marketplace_install_remote",
    {
        description: "Install a tool from the remote GitHub marketplace.",
        inputSchema: z.object({
            id: z.string().describe("Tool name/ID from remote marketplace"),
            overwrite: z.boolean().default(false)
        }),
    },
    async ({ id, overwrite }) => {
        try {
            const token = await getSecret("GITHUB_TOKEN");
            if (!token) {
                return createToolResponse("GitHub token not set. Use set_secret with name 'GITHUB_TOKEN'.");
            }

            const exported = await installFromRemote(id, token);
            if (!exported) {
                return createToolResponse(`Tool '${id}' not found on remote marketplace.`);
            }

            const name = exported.tool.name;
            if (await toolExists(name) && !overwrite) {
                return createToolResponse(`Tool '${name}' exists locally. Use overwrite=true.`);
            }

            const tool = migrateToolData(exported.tool);
            tool.updatedAt = new Date().toISOString();
            await writeToolData(tool);
            await logAudit("marketplace_imported", name, { source: "remote", remoteId: id });
            return createToolResponse(`Tool '${name}' installed from remote marketplace.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "marketplace_delete_remote",
    {
        description: "Remove a tool from the remote GitHub marketplace. Only the original publisher can delete their tools.",
        inputSchema: z.object({
            id: z.string().describe("Tool name/ID to remove from remote")
        }),
    },
    async ({ id }) => {
        try {
            const token = await getSecret("GITHUB_TOKEN");
            if (!token) {
                return createToolResponse("GitHub token not set. Use set_secret with name 'GITHUB_TOKEN'.");
            }

            const result = await deleteFromRemote(id, token);
            if (!result.deleted) {
                return createToolResponse(result.error || `Tool '${id}' not found on remote marketplace.`);
            }
            await logAudit("marketplace_deleted_remote", id);
            return createToolResponse(`Tool '${id}' removed from remote marketplace.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "create_resource",
    {
        description: "Create an MCP resource.",
        inputSchema: z.object({
            uri: z.string().describe("Resource URI"),
            name: z.string(),
            description: z.string(),
            mime_type: z.string().default("text/plain"),
            content: z.string()
        }),
    },
    async ({ uri, name, description, mime_type, content }) => {
        try {
            const resource = await createResource({
                uri,
                name,
                description,
                mimeType: mime_type,
                content
            });
            await logAudit("resource_created", uri);
            return createToolResponse(`Resource created:\n${formatResource(resource)}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "delete_resource",
    {
        description: "Delete an MCP resource.",
        inputSchema: z.object({ uri: z.string() }),
    },
    async ({ uri }) => {
        try {
            const deleted = await deleteResource(uri);
            if (!deleted) {
                return createToolResponse(`Resource '${uri}' not found.`);
            }
            await logAudit("resource_deleted", uri);
            return createToolResponse(`Resource '${uri}' deleted.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "list_resources",
    {
        description: "List all MCP resources.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const resources = await listAllResources();
            if (resources.length === 0) {
                return createToolResponse("No resources defined.");
            }
            const output = resources.map(formatResource).join("\n\n");
            return createToolResponse(`Resources (${resources.length}):\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "get_resource",
    {
        description: "Get a specific MCP resource by URI.",
        inputSchema: z.object({
            uri: z.string().describe("Resource URI to retrieve")
        }),
    },
    async ({ uri }) => {
        try {
            const resource = await getResource(uri);
            if (!resource) {
                return createToolResponse(`Resource '${uri}' not found.`);
            }
            return createToolResponse(`${formatResource(resource)}\n\nContent:\n${resource.content}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "create_prompt",
    {
        description: "Create an MCP prompt template.",
        inputSchema: z.object({
            name: z.string(),
            description: z.string(),
            arguments: z.string().default("[]").describe("JSON array of {name, description, required}"),
            template: z.string().describe("Prompt template with {{arg_name}} placeholders")
        }),
    },
    async ({ name, description, arguments: argsJson, template }) => {
        try {
            let args: Array<{ name: string; description: string; required: boolean }>;
            try {
                args = JSON.parse(argsJson);
            } catch {
                return createToolResponse("Invalid arguments JSON.");
            }

            const prompt = await createPrompt({ name, description, arguments: args, template });
            await logAudit("prompt_created", name);
            return createToolResponse(`Prompt created:\n${formatPrompt(prompt)}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "delete_prompt",
    {
        description: "Delete an MCP prompt.",
        inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => {
        try {
            const deleted = await deletePrompt(name);
            if (!deleted) {
                return createToolResponse(`Prompt '${name}' not found.`);
            }
            await logAudit("prompt_deleted", name);
            return createToolResponse(`Prompt '${name}' deleted.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "list_prompts",
    {
        description: "List all MCP prompts.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const prompts = await listAllPrompts();
            if (prompts.length === 0) {
                return createToolResponse("No prompts defined.");
            }
            const output = prompts.map(formatPrompt).join("\n\n");
            return createToolResponse(`Prompts (${prompts.length}):\n\n${output}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "render_prompt",
    {
        description: "Render a prompt template with arguments.",
        inputSchema: z.object({
            name: z.string(),
            args: z.string().default("{}").describe("JSON object of argument values")
        }),
    },
    async ({ name, args }) => {
        try {
            const prompt = await getPrompt(name);
            if (!prompt) {
                return createToolResponse(`Prompt '${name}' not found.`);
            }

            let parsedArgs: Record<string, string>;
            try {
                parsedArgs = JSON.parse(args);
            } catch {
                return createToolResponse("Invalid args JSON.");
            }

            const rendered = renderPrompt(prompt, parsedArgs);
            return createToolResponse(rendered);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

async function loadExistingTools(): Promise<void> {
    const files = await getAllToolFiles();
    for (const file of files) {
        const name = file.replace(".json", "");
        try {
            const tool = await readToolData(name);
            const { approved } = await checkToolApproval(tool);
            if (!approved) {
                console.error(`Skipping unapproved: ${name}`);
                continue;
            }
            await registerCustomTool(tool);
        } catch (err) {
            console.error(`Failed to load: ${name}`, err);
        }
    }
}

async function gracefulShutdown(): Promise<void> {
    console.error("Shutting down...");
    stopScheduler();
    stopWebhookServer();
    stopDashboard();
    process.exit(0);
}

async function main(): Promise<void> {
    process.on("SIGINT", gracefulShutdown);
    process.on("SIGTERM", gracefulShutdown);

    await ensureDir();
    await cleanExpiredCache();
    await loadExistingTools();

    startScheduler(callToolInternal);
    startWebhookServer(3002, callToolInternal);
    startDashboard(3001, () => registeredTools, getAllToolFiles, readToolData);

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error(`architect-mcp started with ${registeredTools.size} tools.`);
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
