import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "./core/db.js";
import {
    CustomTool,
    JsonSchema,
    ToolListItem,
    validateToolName,
    jsonSchemaToZod,
    migrateToolData,
    Capability,
    ExportedTool,
    PipelineStep,
    isReservedToolName,
    ReservedToolName
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
import { createAlias, deleteAlias, getAlias, listAllAliases, resolveAlias, resolveAliasParams } from "./tools/aliases.js";
import { executeBatch, formatBatchResult } from "./execution/batch.js";
import { createPipeline, getPipeline, deletePipeline, listAllPipelines, executePipeline, formatPipelineResult } from "./execution/pipelines.js";
import { addSchedule, removeSchedule, listAllSchedules, startScheduler, stopScheduler, formatSchedule, startDeprecationChecker, stopDeprecationChecker } from "./execution/scheduler.js";
import { createWebhook, deleteWebhook, listAllWebhooks, startWebhookServer, stopWebhookServer, formatWebhook } from "./execution/webhooks.js";
import { exportToMarketplace, importFromMarketplace, listMarketplace, deleteFromMarketplace, formatMarketplaceEntry, publishToRemote, browseRemote, installFromRemote, deleteFromRemote, reportToolIssue, publishToolStats } from "./tools/marketplace.js";
import { createResource, getResource, deleteResource, listAllResources, formatResource } from "./mcp/resources.js";
import { createPrompt, getPrompt, deletePrompt, listAllPrompts, renderPrompt, formatPrompt } from "./mcp/prompts.js";
import { getCachedResult, setCachedResult, clearCacheForTool, clearAllCache, getCacheStats, cleanExpiredCache, flushCache, startCacheFlushInterval, stopCacheFlushInterval } from "./core/cache.js";
import { setSecret, getSecret, deleteSecret, listSecrets } from "./core/secrets.js";
import { startDashboard, stopDashboard } from "./dashboard/dashboard.js";
import { buildKnowledgePrompt, getCachedKnowledge, setCachedKnowledge, clearAllKnowledgeCache, getKnowledgeCacheStats, clearExpiredKnowledgeCache } from "./core/knowledge.js";
import { createPersona, getPersona, updatePersona, deletePersona, listPersonas, formatPersona } from "./tools/personas.js";
import { setMemory, getMemory, deleteMemory, listMemory, clearMemory } from "./core/memory.js";
import { runAnomalyCheck, getActiveAnomalies, clearAnomaly, resetBaseline, startAnomalyChecker, stopAnomalyChecker } from "./core/anomaly.js";
import { getMutationCandidates, getMutationContext } from "./core/mutation.js";
import { matchIntent } from "./core/intent.js";

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

function toolExists(name: string): boolean {
    const db = getDb();
    const row = db.prepare("SELECT name FROM tools WHERE name = ?").get(name);
    return row !== undefined;
}

function readToolData(name: string): CustomTool {
    const db = getDb();
    const row = db.prepare("SELECT * FROM tools WHERE name = ?").get(name) as any;
    if (!row) throw new Error(`Tool '${name}' not found`);
    return migrateToolData({
        name: row.name,
        description: row.description,
        code: row.code,
        schema: JSON.parse(row.schema),
        capabilities: JSON.parse(row.capabilities || "[]"),
        category: row.category,
        tags: JSON.parse(row.tags || "[]"),
        dependencies: JSON.parse(row.dependencies || "[]"),
        version: row.version,
        author: row.author || undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deprecated: row.deprecated === 1 || undefined,
        failingSince: row.failing_since || undefined,
        rateLimit: row.rate_limit ? JSON.parse(row.rate_limit) : undefined,
        cache: row.cache_config ? JSON.parse(row.cache_config) : undefined,
        retry: row.retry_config ? JSON.parse(row.retry_config) : undefined,
        tests: row.tests ? JSON.parse(row.tests) : undefined
    });
}

async function writeToolData(tool: CustomTool): Promise<void> {
    const db = getDb();
    try {
        const existing = readToolData(tool.name);
        await saveVersion(tool.name, existing);
    } catch { }
    db.prepare(
        `INSERT OR REPLACE INTO tools
         (name, description, code, schema, capabilities, category, tags, dependencies, version,
          author, created_at, updated_at, deprecated, failing_since, rate_limit, cache_config, retry_config, tests)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        tool.name, tool.description, tool.code,
        JSON.stringify(tool.schema),
        JSON.stringify(tool.capabilities || []),
        tool.category || "other",
        JSON.stringify(tool.tags || []),
        JSON.stringify(tool.dependencies || []),
        tool.version,
        tool.author || null,
        tool.createdAt,
        tool.updatedAt,
        tool.deprecated ? 1 : 0,
        tool.failingSince || null,
        tool.rateLimit ? JSON.stringify(tool.rateLimit) : null,
        tool.cache ? JSON.stringify(tool.cache) : null,
        tool.retry ? JSON.stringify(tool.retry) : null,
        tool.tests ? JSON.stringify(tool.tests) : null
    );
}

function deleteToolFile(name: string): void {
    const db = getDb();
    db.prepare("DELETE FROM tools WHERE name = ?").run(name);
}

function getAllToolFiles(): string[] {
    const db = getDb();
    const rows = db.prepare("SELECT name FROM tools").all() as any[];
    return rows.map(r => `${r.name}.json`);
}

function ensureDir(): Promise<void> {
    return Promise.resolve();
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

            let deprecationWarning = "";
            if (tool.failingSince) {
                const daysSince = Math.floor((Date.now() - new Date(tool.failingSince).getTime()) / 86400000);
                deprecationWarning = `⚠️ This tool has been failing since ${tool.failingSince} (${daysSince}d). Consider calling update_tool to fix it.\n\n`;
            }

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
                if (cached.hit) {
                    return createToolResponse(JSON.stringify(cached.result, null, 2) + "\n\n(cached)");
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
                return createToolResponse(deprecationWarning + output);
            } catch (err) {
                const duration = Date.now() - startTime;
                const errorMsg = err instanceof Error ? err.message : String(err);
                await recordExecution(tool.name, false, duration);
                await logAudit("tool_execution_failed", tool.name, { error: errorMsg }, duration);
                return createToolResponse(`Execution Error: ${errorMsg}\n\nTo fix this tool, call update_tool with name '${tool.name}' and a corrected version of the code below:\n\n\`\`\`javascript\n${tool.code}\n\`\`\``);
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
        description: "Create a new reusable tool. ALWAYS call search_tools first — rebuild nothing that exists. Design for the general case, never for the specific task. fetch() returns {ok,status,body} — never call .text() or .json(). Credentials via secrets.get() only. Include at least one test case.",
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
            author: z.string().optional(),
            github_token: z.string().optional().describe("GitHub token to auto-check marketplace before creating")
        }),
    },
    async ({ name, description, schema, code, capabilities, category, tags, dependencies, rate_limit_per_minute, rate_limit_per_hour, author, github_token }) => {
        try {
            const validation = validateToolName(name);
            if (!validation.valid) {
                return createToolResponse(`Validation Error: ${validation.error}`);
            }

            if (await toolExists(name)) {
                return createToolResponse(`Tool '${name}' already exists. Use update_tool to modify it.`);
            }

            if (github_token) {
                try {
                    const marketplaceMatches = await browseRemote(github_token, name);
                    if (marketplaceMatches.length > 0) {
                        const suggestions = marketplaceMatches
                            .slice(0, 3)
                            .map(e => `  - ${e.name} by ${e.author}: ${e.description}`)
                            .join("\n");
                        return createToolResponse(
                            `Marketplace match found for '${name}'. Install instead of rebuilding:\n\n${suggestions}\n\nUse install_from_remote to install one of these.`
                        );
                    }
                } catch {
                }
            }

            {
                const existingFiles = await getAllToolFiles();
                if (existingFiles.length > 0) {
                    const tools = await Promise.all(
                        existingFiles.map(f => readToolData(f.replace(".json", "")))
                    );
                    const response = matchIntent(`${name} ${description}`, tools);
                    const matches = response.matches.filter(m => m.confidence > 0.4).slice(0, 3);

                    if (matches.length > 0) {
                        const hint = matches.map(m => `  - ${m.tool.name} (confidence: ${(m.confidence * 100).toFixed(0)}%): ${m.tool.description}`).join("\n");
                        return createToolResponse(
                            `Before creating '${name}', consider using or composing these existing tools:\n\n${hint}\n\nUse callTool() in your code or set dependencies[] to chain them. If none fit, call create_tool again to proceed.`
                        );
                    }
                }
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

            const cacheKey = `${name}:${description}:${code}`;
            let knowledgePrompt = await getCachedKnowledge(cacheKey);
            if (!knowledgePrompt) {
                knowledgePrompt = buildKnowledgePrompt();
                await setCachedKnowledge(cacheKey, knowledgePrompt);
            }

            let response = knowledgePrompt + "\n\n---\n\n";
            response += `Tool '${name}' created (v1).`;
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
        description: "Fix or improve an existing tool. Read the full error before changing anything. One targeted fix beats delete and rebuild every time. Never narrow a tool's scope to make an error go away.",
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
            rate_limit_per_hour: z.number().optional(),
            github_token: z.string().optional().describe("GitHub token to check marketplace for newer version")
        }),
    },
    async ({ name, description, schema, code, capabilities, category, tags, dependencies, rate_limit_per_minute, rate_limit_per_hour, github_token }) => {
        try {
            if (!await toolExists(name)) {
                return createToolResponse(`Tool '${name}' not found.`);
            }

            const existing = await readToolData(name);

            let marketplaceNote = "";
            if (github_token) {
                try {
                    const matches = await browseRemote(github_token, name);
                    const remote = matches.find(e => e.name === name);
                    if (remote && parseInt(remote.version, 10) > existing.version) {
                        marketplaceNote = `\n\n💡 Marketplace has v${remote.version} of '${name}' by ${remote.author}. Consider installing it instead with install_from_remote.`;
                    }
                } catch {
                }
            }

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

            const cacheKey = `${name}:${updated.description}:${updated.code}`;
            let knowledgePrompt = await getCachedKnowledge(cacheKey);
            if (!knowledgePrompt) {
                knowledgePrompt = buildKnowledgePrompt();
                await setCachedKnowledge(cacheKey, knowledgePrompt);
            }
            const kp = knowledgePrompt + "\n\n---\n\n";

            if (registeredTools.has(name)) {
                const { approved, missing } = await checkToolApproval(updated);
                if (!approved) {
                    await unregisterCustomTool(name);
                    await notifyToolsChanged();
                    return createToolResponse(
                        kp +
                        `Tool '${name}' updated to v${updated.version} but deactivated.\n\n` +
                        `New capabilities require approval:\n${formatCapabilities(missing)}` +
                        marketplaceNote
                    );
                }

                await registerCustomTool(updated);
                await notifyToolsChanged();
                return createToolResponse(kp + `Tool '${name}' updated to v${updated.version} and reloaded.` + marketplaceNote);
            }

            return createToolResponse(kp + `Tool '${name}' updated to v${updated.version}.` + marketplaceNote);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "mark_tool_deprecated",
    {
        description: "Mark a tool as deprecated when it cannot be fixed. Always search for or build a replacement immediately after deprecating.",
        inputSchema: z.object({
            name: z.string().describe("Tool name"),
            deprecated: z.boolean().describe("true to mark deprecated, false to clear deprecation"),
            reason: z.string().optional().describe("Optional reason for deprecation")
        }),
    },
    async ({ name, deprecated, reason }) => {
        try {
            if (!await toolExists(name)) {
                return createToolResponse(`Tool '${name}' not found.`);
            }
            const tool = await readToolData(name);
            if (deprecated) {
                tool.deprecated = true;
                tool.failingSince = tool.failingSince ?? new Date().toISOString();
            } else {
                tool.deprecated = false;
                delete tool.failingSince;
            }
            tool.updatedAt = new Date().toISOString();
            await writeToolData(tool);
            await logAudit(deprecated ? "tool_deprecated" : "tool_undeprecated", name, { reason });
            const msg = deprecated
                ? `Tool '${name}' marked as deprecated.${reason ? ` Reason: ${reason}` : ""} Agents will be warned to find a replacement.`
                : `Tool '${name}' deprecation cleared.`;
            return createToolResponse(msg);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "validate_tool",
    {
        description: "Validate JavaScript syntax without creating the tool. Run this before create_tool when the code is complex.",
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
        description: "Activate a tool after creation or approval. Run this after approve_tool if capabilities were requested.",
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
        description: "Approve capabilities for a tool before activation. Request minimum capabilities only — precise approvals are faster. net needs domains, fs needs mode and paths, child_process needs exact commands, env needs exact variable names.",
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
        description: "Revoke approved capabilities and deactivate a tool. Use when a tool's capability scope needs to change.",
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
        description: "List all approved capability sets. Review this when debugging why a tool cannot access network, filesystem, or environment.",
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
        description: "Delete a tool permanently. If the tool has failures — fix it with update_tool first. Deleting and rebuilding narrower destroys the ecosystem.",
        inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => {
        try {
            if (!await toolExists(name)) {
                return createToolResponse(`Tool '${name}' not found.`);
            }

            const stats = await getToolStats(name);
            if (stats && stats.failedCalls > 0 && stats.successfulCalls === 0) {
                const tool = await readToolData(name);
                return createToolResponse(
                    `⚠️ Tool '${name}' has never succeeded (${stats.failedCalls} failure(s)). Deletion blocked.\n\n` +
                    `Fix it first with update_tool — a failing tool is one fix away from working.\n\n` +
                    `Current code:\n\`\`\`javascript\n${tool.code}\n\`\`\`\n\n` +
                    `If you truly want to delete it, call delete_tool again with force=true.`
                );
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
        description: "List all tools with optional filtering by active status, category, or tag. Run this before building anything to understand what already exists.",
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
                        tags: tool.tags,
                        deprecated: tool.deprecated
                    });
                } catch { continue; }
            }

            if (tools.length === 0) {
                return createToolResponse("No matching tools found.");
            }

            const output = tools.map(t => {
                const status = registeredTools.has(t.name) ? (t.deprecated ? "[DEPRECATED]" : "[ACTIVE]") : "[INACTIVE]";
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
        description: "Get full source code and metadata for a tool. Run this before update_tool to understand what you are changing.",
        inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => {
        try {
            if (!await toolExists(name)) {
                return createToolResponse(`Tool '${name}' not found.`);
            }

            const tool = await readToolData(name);
            const status = registeredTools.has(name) ? (tool.deprecated ? "DEPRECATED" : "ACTIVE") : "INACTIVE";

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
        description: "Get execution statistics for a tool or all tools. Use to spot failure patterns before they become anomalies.",
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
        description: "Export a tool as portable JSON including permissions. Use before marketplace_publish or to back up a tool.",
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
        description: "Import a tool from exported JSON. Use to restore a backup or install a shared tool.",
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
        description: "List available starter templates. Run before create_tool — never write from scratch what a template already provides.",
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
        description: "Create a tool from a template. Always prefer this over writing from scratch when a template fits.",
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

            const cacheKey = `${name}:${tool.description}:${tool.code}`;
            let knowledgePrompt = await getCachedKnowledge(cacheKey);
            if (!knowledgePrompt) {
                knowledgePrompt = buildKnowledgePrompt();
                await setCachedKnowledge(cacheKey, knowledgePrompt);
            }

            let response = knowledgePrompt + "\n\n---\n\n";
            response += `Tool '${name}' created from template '${template_id}'.`;
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
        description: "Get the execution audit trail for a tool or all tools. Run when debugging unexpected behavior or tracing what changed and when.",
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
        description: "Reload all approved tools from disk. Run after manual file changes or after recovering from an error state.",
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
        description: "List version history for a tool. Run before rollback_tool to find the right version.",
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
        description: "Roll back a tool to a previous version. Use when an update broke something and the fix is not obvious.",
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
        description: "Compare two versions of a tool. Run before rollback to understand exactly what changed.",
        inputSchema: z.object({
            name: z.string(),
            v1: z.number(),
            v2: z.number()
        }),
    },
    async ({ name, v1, v2 }) => {
        try {
            const diffs = await diffVersions(name, v1, v2);
            if (!diffs || diffs.changes.length === 0) {
                return createToolResponse(`No differences between v${v1} and v${v2}.`);
            }

            const output = diffs.changes.map((d: { field: string; from: any; to: any }) =>
                `${d.field}:\n  v${v1}: ${JSON.stringify(d.from)}\n  v${v2}: ${JSON.stringify(d.to)}`
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
        description: "Store an encrypted credential. Always use this for API keys, tokens, passwords, and connection strings. Never put credentials in tool code.",
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
        description: "Retrieve a masked view of a stored secret name. Use list_secrets to see what credentials are available before building tools that need them.",
        inputSchema: z.object({ name: z.string() }),
    },
    async ({ name }) => {
        try {
            const value = await getSecret(name);
            if (value === null) {
                return createToolResponse(`Secret '${name}' not found.`);
            }
            const masked = value.length > 8
                ? value.slice(0, 4) + "****" + value.slice(-4)
                : "****";
            return createToolResponse(`Secret '${name}': ${masked}\n\n(Full value available to tools via secrets.get())`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "delete_secret",
    {
        description: "Delete a stored secret. Verify no active tools depend on it before deleting.",
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
        description: "List all stored secret names. Run this before building tools that need credentials to know what is already available.",
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
        description: "Clear cached results for a tool or all tools. Run after fixing a tool that was returning wrong cached results.",
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
        description: "Get cache hit rate and entry counts. Use to decide if a tool needs cache TTL adjustment.",
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
        description: "Run all test cases for a tool. Run after every update_tool call to confirm the fix worked. A tool with no passing tests is a tool waiting to fail silently.",
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
        description: "Create a named shortcut for a tool with preset parameters. Create aliases for any tool called repeatedly with the same base configuration.",
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

            const entry = await createAlias({ alias, targetTool: target_tool, presetParams: params, description });
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
        description: "Delete a tool alias. The underlying tool is not affected.",
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
        description: "List all tool aliases. Check this before creating an alias — it may already exist.",
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
        description: "Execute a tool through a named alias with preset parameters. Use for frequently repeated calls with the same base params.",
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

            const resolved = await resolveAlias(alias, inputParams);
            if (!resolved) {
                return createToolResponse(`Alias '${alias}' not found.`);
            }
            const result = await callToolInternal(resolved.toolName, resolved.mergedParams);
            return createToolResponse(JSON.stringify(result, null, 2));
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "batch_execute",
    {
        description: "Execute a tool against multiple inputs in parallel. Use instead of looping callTool() manually. Set concurrency based on rate limits.",
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
        description: "Chain multiple tools into a reusable pipeline. Create a pipeline any time two or more tools always run in sequence for a task.",
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
        description: "Run a pipeline with optional initial input. Output of each step is available to the next via $prev.result or $stepName.result.",
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
        description: "Delete a pipeline. The individual tools inside it are not affected.",
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
        description: "List all pipelines. Check this before building a new sequence — the pipeline may already exist.",
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
        description: "Schedule a tool to run automatically on a cron expression. Create a schedule immediately after building any tool for a recurring task — do not wait to be asked.",
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
        description: "Delete a schedule. The tool itself is not affected.",
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
        description: "List all active schedules with next run times.",
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
        description: "Expose a tool as an HTTP endpoint. Create a webhook for any tool that needs to be triggered by external systems or events.",
        inputSchema: z.object({
            tool_name: z.string(),
            path: z.string().describe("Webhook path (e.g. '/my-hook')"),
            method: z.enum(["GET", "POST"]).default("POST"),
            secret: z.string().optional().describe("Optional webhook secret for authentication")
        }),
    },
    async ({ tool_name, path: webhookPath, method, secret }) => {
        try {
            if (!isReservedToolName(tool_name as ReservedToolName)) {
                try {
                    await readToolData(tool_name);
                } catch {
                    throw new Error(`Tool '${tool_name}' not found. Cannot create webhook.`);
                }
            }

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
        description: "Delete a webhook endpoint. The tool itself is not affected.",
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
        description: "List all webhook endpoints with their paths and methods.",
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
        description: "Export a tool to the local marketplace for sharing or backup.",
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
        description: "Import a tool from the local marketplace.",
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
        description: "List all tools in the local marketplace.",
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
            await logAudit("marketplace_deleted", id);
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
        description: "Browse the remote GitHub marketplace. Run before create_tool — install community tools instead of rebuilding common functionality.",
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
        description: "Install a tool from the remote marketplace. Always prefer installing over rebuilding.",
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
    "report_tool_issue",
    {
        description: "Report a failure with a marketplace tool. Run when an installed tool is consistently failing so the community knows.",
        inputSchema: z.object({
            id: z.string().describe("Marketplace tool ID"),
            github_token: z.string().describe("GitHub token")
        }),
    },
    async ({ id, github_token }) => {
        try {
            const result = await reportToolIssue(id, github_token);
            return createToolResponse(
                `Issue reported for '${id}'.\n  Failure Reports: ${result.failureReports}\n  Success Rate: ${result.successRate}%`
            );
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "publish_tool_stats",
    {
        description: "Share real usage data for a marketplace tool. Run after a tool accumulates meaningful usage to contribute back to the community.",
        inputSchema: z.object({
            id: z.string().describe("Marketplace tool ID"),
            tool_name: z.string().describe("Local tool name to read stats from"),
            github_token: z.string().describe("GitHub token")
        }),
    },
    async ({ id, tool_name, github_token }) => {
        try {
            const result = await publishToolStats(id, tool_name, github_token);
            return createToolResponse(result.message);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "create_resource",
    {
        description: "Create an MCP resource — a named, versioned piece of content accessible to any agent in context.",
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
        description: "List all MCP resources available in context.",
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
        description: "Get a specific MCP resource by URI including its full content.",
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
        description: "Create a reusable MCP prompt template with named arguments and placeholders.",
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
        description: "Delete an MCP prompt template.",
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
        description: "List all MCP prompt templates.",
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
        description: "Render a prompt template with argument values. Use before passing a prompt to an LLM call.",
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

server.registerTool(
    "search_tools",
    {
        description: "Search tools by natural language. ALWAYS run this before create_tool. If confidence > 40% — use or compose the existing tool instead of building.",
        inputSchema: z.object({
            query: z.string().describe("Natural language search query"),
            limit: z.number().optional().describe("Max results to return (default 10)")
        }),
    },
    async ({ query, limit = 10 }) => {
        try {
            const files = await getAllToolFiles();
            const tools = await Promise.all(
                files.map(f => readToolData(f.replace(".json", "")))
            );

            const response = matchIntent(query, tools);
            const matches = response.matches.slice(0, limit);

            if (matches.length === 0) {
                return createToolResponse(`No tools found matching '${query}'.`);
            }

            const lines = matches.map(({ tool, score, confidence }) =>
                `  ${tool.name} (confidence: ${(confidence * 100).toFixed(1)}%, score: ${score.toFixed(1)})\n    ${tool.description}${tool.tags?.length ? `\n    tags: ${tool.tags.join(", ")}` : ""}`
            );

            let output = `Found ${matches.length} tool(s) for '${query}':\n\n${lines.join("\n\n")}`;
            if (response.suggestions && response.suggestions.length > 0) {
                output += `\n\n💡 Suggestions:\n${response.suggestions.join("\n")}`;
            }

            return createToolResponse(output);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "get_tool_graph",
    {
        description: "Get the full dependency graph of all tools. Run before building to understand composition opportunities. Prefer extending an existing graph over adding isolated tools.",
        inputSchema: z.object({
            tool_name: z.string().optional().describe("If provided, returns only the subgraph for this tool")
        }),
    },
    async ({ tool_name }) => {
        try {
            const files = await getAllToolFiles();
            const allTools: CustomTool[] = await Promise.all(
                files.map(f => readToolData(f.replace(".json", "")))
            );

            const nameSet = new Set(allTools.map(t => t.name));
            const dependents: Record<string, string[]> = {};

            for (const tool of allTools) {
                dependents[tool.name] = [];
            }
            for (const tool of allTools) {
                for (const dep of (tool.dependencies ?? [])) {
                    if (nameSet.has(dep)) {
                        dependents[dep].push(tool.name);
                    }
                }
            }

            if (tool_name) {
                const tool = allTools.find(t => t.name === tool_name);
                if (!tool) return createToolResponse(`Tool '${tool_name}' not found.`);

                const deps = (tool.dependencies ?? []).filter(d => nameSet.has(d));
                const usedBy = dependents[tool_name] ?? [];
                const lines = [
                    `Tool: ${tool_name}`,
                    `  Depends on: ${deps.length ? deps.join(", ") : "(none)"}`,
                    `  Used by:    ${usedBy.length ? usedBy.join(", ") : "(none)"}`
                ];
                return createToolResponse(lines.join("\n"));
            }

            const roots = allTools.filter(t => (t.dependencies ?? []).filter(d => nameSet.has(d)).length === 0);
            const orphans = allTools.filter(t =>
                (t.dependencies ?? []).filter(d => nameSet.has(d)).length === 0 &&
                (dependents[t.name] ?? []).length === 0
            );

            const lines: string[] = [`Tool Dependency Graph (${allTools.length} tools)\n`];

            lines.push("Roots (no dependencies):");
            for (const t of roots) {
                const usedBy = dependents[t.name] ?? [];
                lines.push(`  ${t.name} → used by: ${usedBy.length ? usedBy.join(", ") : "(none)"}`);
            }

            const withDeps = allTools.filter(t => (t.dependencies ?? []).filter(d => nameSet.has(d)).length > 0);
            if (withDeps.length > 0) {
                lines.push("\nWith dependencies:");
                for (const t of withDeps) {
                    const deps = (t.dependencies ?? []).filter(d => nameSet.has(d));
                    lines.push(`  ${t.name} → depends on: ${deps.join(", ")}`);
                }
            }

            if (orphans.length > 0) {
                lines.push(`\nOrphans (no deps, not used by anyone): ${orphans.map(t => t.name).join(", ")}`);
            }

            return createToolResponse(lines.join("\n"));
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "create_persona",
    {
        description: "Save a named agent configuration grouping related tools with an optional system prompt. Create a persona after completing any multi-tool task so future agents can activate this context instantly.",
        inputSchema: z.object({
            name: z.string().describe("Unique persona name"),
            description: z.string().describe("What this persona is for"),
            tools: z.array(z.string()).describe("List of tool names included in this persona"),
            system_prompt: z.string().optional().describe("Optional system prompt override for this persona")
        }),
    },
    async ({ name, description, tools, system_prompt }) => {
        try {
            const persona = await createPersona({ name, description, tools, systemPrompt: system_prompt });
            return createToolResponse(`Persona '${name}' created with ${tools.length} tools.\n\n${formatPersona(persona)}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "list_personas",
    {
        description: "List all saved personas. ALWAYS run this at task start — activate a matching persona before reaching for individual tools.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const personas = await listPersonas();
            if (personas.length === 0) return createToolResponse("No personas defined yet. Use create_persona to create one.");
            return createToolResponse(`${personas.length} persona(s):\n\n${personas.map(formatPersona).join("\n\n")}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "activate_persona",
    {
        description: "Load a persona's tool list and system prompt. Activating a persona scopes your work to the right tool set for the context.",
        inputSchema: z.object({
            name: z.string().describe("Persona name to activate")
        }),
    },
    async ({ name }) => {
        try {
            const persona = await getPersona(name);
            if (!persona) return createToolResponse(`Persona '${name}' not found.`);
            const lines = [
                `Activating persona: ${persona.name}`,
                `Description: ${persona.description}`,
                `Active tools (${persona.tools.length}): ${persona.tools.join(", ")}`,
            ];
            if (persona.systemPrompt) {
                lines.push(`\nSystem Prompt:\n${persona.systemPrompt}`);
            }
            lines.push(`\nUse only the listed tools for this session to stay in persona.`);
            return createToolResponse(lines.join("\n"));
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "delete_persona",
    {
        description: "Delete a saved agent persona. The tools inside it are not affected.",
        inputSchema: z.object({
            name: z.string().describe("Persona name to delete")
        }),
    },
    async ({ name }) => {
        try {
            const deleted = await deletePersona(name);
            if (!deleted) return createToolResponse(`Persona '${name}' not found.`);
            return createToolResponse(`Persona '${name}' deleted.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "update_persona",
    {
        description: "Update a persona's tool list, description, or system prompt. Run after adding or removing tools from a task context.",
        inputSchema: z.object({
            name: z.string().describe("Persona name to update"),
            description: z.string().optional(),
            tools: z.array(z.string()).optional().describe("Replacement tool list"),
            system_prompt: z.string().optional()
        }),
    },
    async ({ name, description, tools, system_prompt }) => {
        try {
            const updated = await updatePersona(name, {
                ...(description !== undefined && { description }),
                ...(tools !== undefined && { tools }),
                ...(system_prompt !== undefined && { systemPrompt: system_prompt })
            });
            if (!updated) return createToolResponse(`Persona '${name}' not found.`);
            return createToolResponse(`Persona '${name}' updated.\n\n${formatPersona(updated)}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "knowledge_cache_stats",
    {
        description: "Get statistics about the knowledge prompt cache.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const stats = await getKnowledgeCacheStats();
            return createToolResponse(`Knowledge Cache Stats:\n\nTotal: ${stats.total}\nFresh: ${stats.fresh}\nExpired: ${stats.expired}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "clear_knowledge_cache",
    {
        description: "Clear the knowledge cache to force fresh principles on next tool creation.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const cleared = await clearAllKnowledgeCache();
            return createToolResponse(`Cleared ${cleared} knowledge cache entries.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "get_anomalies",
    {
        description: "List tools currently performing outside their baseline. Review anomalies before starting work — a degraded tool will slow down your task.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const anomalies = await getActiveAnomalies();
            if (anomalies.length === 0) {
                return createToolResponse("No anomalies detected. All tools are performing within normal parameters.");
            }
            const lines = anomalies.map(a => {
                const durationDelta = a.baselineAvgDurationMs > 0
                    ? ` (${(a.currentAvgDurationMs / a.baselineAvgDurationMs).toFixed(1)}x baseline)`
                    : "";
                return [
                    `⚠️  ${a.toolName} — detected ${a.detectedAt}`,
                    `   Reasons: ${a.reasons.join("; ")}`,
                    `   Duration: ${a.currentAvgDurationMs}ms${durationDelta}`,
                    `   Fail rate: ${(a.currentFailRate * 100).toFixed(1)}% (baseline: ${(a.baselineFailRate * 100).toFixed(1)}%)`
                ].join("\n");
            });
            return createToolResponse(`Anomalies (${anomalies.length}):\n\n${lines.join("\n\n")}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "run_anomaly_check",
    {
        description: "Manually trigger anomaly detection across all tools. Run when tools are behaving unexpectedly.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const detected = await runAnomalyCheck();
            if (detected.length === 0) {
                return createToolResponse("Anomaly check complete. No anomalies detected.");
            }
            const names = detected.map(a => `  - ${a.toolName}: ${a.reasons.join("; ")}`).join("\n");
            return createToolResponse(`Anomaly check complete. ${detected.length} anomaly(s) detected:\n\n${names}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "clear_anomaly",
    {
        description: "Clear the anomaly flag after fixing a tool. Always run this after a successful update_tool fix.",
        inputSchema: z.object({
            tool_name: z.string().describe("Tool name to clear the anomaly flag for")
        }),
    },
    async ({ tool_name }) => {
        try {
            const cleared = await clearAnomaly(tool_name);
            if (!cleared) {
                return createToolResponse(`No active anomaly for '${tool_name}'.`);
            }
            return createToolResponse(`Anomaly flag cleared for '${tool_name}'.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "reset_anomaly_baseline",
    {
        description: "Reset the performance baseline after an intentional change. Run after any update that deliberately changes a tool's speed or behavior.",
        inputSchema: z.object({
            tool_name: z.string().describe("Tool name to reset the baseline for")
        }),
    },
    async ({ tool_name }) => {
        try {
            const reset = await resetBaseline(tool_name);
            if (!reset) {
                return createToolResponse(`No stats found for '${tool_name}'. Run the tool at least ${5} times first.`);
            }
            return createToolResponse(`Baseline reset for '${tool_name}'. Current stats are now the new normal.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "get_mutation_proposals",
    {
        description: "List tools that need proactive rewriting based on failure patterns. Review proposals before starting a session — fix degraded tools before building new ones.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const candidates = await getMutationCandidates();
            if (candidates.length === 0) {
                return createToolResponse("No mutation candidates found. All tools are performing well.");
            }
            const lines = candidates.map(c =>
                `[${c.priority.toUpperCase()}] ${c.toolName}\n  Issue: ${c.anomaly.reasons.join("; ")}\n  Suggestion: ${c.suggestedAction}`
            );
            return createToolResponse(`Mutation Candidates (${candidates.length}):\n\n${lines.join("\n\n")}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "get_mutation_context",
    {
        description: "Get full diagnostic context for rewriting a failing tool — code, stats, errors, anomaly details. Always run this before update_tool on a failing tool.",
        inputSchema: z.object({
            tool_name: z.string().describe("Tool name to get context for")
        }),
    },
    async ({ tool_name }) => {
        try {
            const context = await getMutationContext(
                tool_name,
                async (name: string) => readToolData(name),
                getToolStats,
                (name, limit) => getAuditLogs({ toolName: name, limit })
            );

            const lines = [
                `Mutation Context for '${tool_name}':`,
                `Current Fail Rate: ${((context.anomaly?.currentFailRate || 0) * 100).toFixed(1)}% (Baseline: ${((context.anomaly?.baselineFailRate || 0) * 100).toFixed(1)}%)`,
                `Current Avg Duration: ${context.stats?.averageDurationMs || 0}ms`,
                `Recent Issues: ${context.anomaly?.reasons.join("; ") || "None"}`,
                `\nRecent Logs:`,
                ...context.recentLogs.map(l => `  [${l.timestamp}] ${l.action}${l.duration ? ` (${l.duration}ms)` : ""}${l.details ? ` - ${JSON.stringify(l.details)}` : ""}`),
                `\nSource Code:\n\`\`\`javascript\n${context.tool.code}\n\`\`\``
            ];

            return createToolResponse(lines.join("\n"));
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "set_memory",
    {
        description: "Persist a key-value pair across sessions. Use for task context, user preferences, and state that must survive server restarts. Use namespaces to group related data.",
        inputSchema: z.object({
            key: z.string().describe("Memory key"),
            value: z.string().describe("Value to store (string, JSON, or plain text)"),
            namespace: z.string().optional().default("default").describe("Namespace to group related keys"),
            ttl_seconds: z.number().optional().describe("Optional TTL in seconds — entry auto-expires after this duration")
        }),
    },
    async ({ key, value, namespace, ttl_seconds }) => {
        try {
            await setMemory(key, value, namespace, ttl_seconds);
            const expiry = ttl_seconds ? ` (expires in ${ttl_seconds}s)` : "";
            return createToolResponse(`Memory set: [${namespace}] ${key}${expiry}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "get_memory",
    {
        description: "Retrieve a persisted value by key and namespace. Check memory before asking the user for context they may have already provided.",
        inputSchema: z.object({
            key: z.string().describe("Memory key to retrieve"),
            namespace: z.string().optional().default("default").describe("Namespace the key belongs to")
        }),
    },
    async ({ key, namespace }) => {
        try {
            const value = await getMemory(key, namespace);
            if (value === null) {
                return createToolResponse(`Memory key '[${namespace}] ${key}' not found or expired.`);
            }
            return createToolResponse(value);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "delete_memory",
    {
        description: "Delete a specific key from cross-session memory.",
        inputSchema: z.object({
            key: z.string().describe("Memory key to delete"),
            namespace: z.string().optional().default("default").describe("Namespace the key belongs to")
        }),
    },
    async ({ key, namespace }) => {
        try {
            const deleted = await deleteMemory(key, namespace);
            if (!deleted) {
                return createToolResponse(`Memory key '[${namespace}] ${key}' not found.`);
            }
            return createToolResponse(`Memory key '[${namespace}] ${key}' deleted.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "list_memory",
    {
        description: "List all memory entries optionally filtered by namespace. Run at task start to load relevant context automatically.",
        inputSchema: z.object({
            namespace: z.string().optional().describe("Filter by namespace (omit to list all)")
        }),
    },
    async ({ namespace }) => {
        try {
            const entries = await listMemory(namespace);
            if (entries.length === 0) {
                return createToolResponse(namespace ? `No memory entries in namespace '${namespace}'.` : "Memory is empty.");
            }
            const lines = entries.map(e => {
                const expiry = e.expiresAt ? ` [expires: ${e.expiresAt}]` : "";
                return `[${e.namespace}] ${e.key}${expiry}\n  ${e.value.length > 120 ? e.value.slice(0, 120) + "…" : e.value}`;
            });
            return createToolResponse(`Memory (${entries.length} entries):\n\n${lines.join("\n\n")}`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "clear_memory",
    {
        description: "Clear all cross-session memory entries, or all entries within a specific namespace.",
        inputSchema: z.object({
            namespace: z.string().optional().describe("Namespace to clear (omit to clear everything)")
        }),
    },
    async ({ namespace }) => {
        try {
            const count = await clearMemory(namespace);
            const scope = namespace ? `namespace '${namespace}'` : "all namespaces";
            return createToolResponse(`Cleared ${count} memory ${count === 1 ? "entry" : "entries"} from ${scope}.`);
        } catch (error) {
            return createErrorResponse(error);
        }
    }
);

server.registerTool(
    "match_intent",
    {
        description: "Deep intent matching with confidence scores and composition suggestions. Run when search_tools returns low confidence to find composition paths.",
        inputSchema: z.object({
            query: z.string().describe("Natural language query or intent"),
        }),
    },
    async ({ query }) => {
        try {
            const files = await getAllToolFiles();
            const tools = await Promise.all(
                files.map(f => readToolData(f.replace(".json", "")))
            );
            const response = matchIntent(query, tools);
            return createToolResponse(JSON.stringify(response, null, 2));
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
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("JSON") || msg.includes("Unexpected token") || msg.includes("Unexpected end")) {
                console.error(`[CORRUPT] Tool '${name}' has invalid JSON: ${msg}`);
            } else if (msg.includes("migration") || msg.includes("schema")) {
                console.error(`[INVALID] Tool '${name}' failed schema migration: ${msg}`);
            } else {
                console.error(`[ERROR] Tool '${name}' failed to load: ${msg}`);
            }
        }
    }
}

async function gracefulShutdown(): Promise<void> {
    console.error("Shutting down...");
    stopScheduler();
    stopDeprecationChecker();
    stopAnomalyChecker();
    stopCacheFlushInterval();
    await flushCache();
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

    startCacheFlushInterval();
    startScheduler(callToolInternal);
    startDeprecationChecker(
        async () => {
            const files = await getAllToolFiles();
            return Promise.all(files.map(f => readToolData(f.replace(".json", ""))));
        },
        writeToolData
    );
    startAnomalyChecker();
    startWebhookServer(3002, callToolInternal);
    startDashboard(
        3001,
        () => registeredTools,
        async () => getAllToolFiles(),
        async (name: string) => readToolData(name),
        writeToolData,
        async () => {
            await loadExistingTools();
        },
        async (exportedJson: string) => {
            const data = JSON.parse(exportedJson);
            const tool = data.tool as CustomTool;
            await writeToolData(tool);
            await registerCustomTool(tool);
            await notifyToolsChanged();
            return { name: tool.name };
        },
        async (name: string, params: Record<string, unknown>) => {
            const tool = registeredTools.get(name);
            if (!tool) throw new Error(`Tool '${name}' not found`);
            const permission = await getToolPermissions(name);
            const approvedCaps = permission?.approvedCapabilities ?? [];
            const sandbox = new ToolSandbox({ timeoutMs: 30000, capabilities: approvedCaps, toolCaller: callToolInternal });
            try {
                const r = await sandbox.execute(tool.code, params);
                if (!r.success) throw new Error(r.error);
                return { result: r.result, logs: r.logs };
            } finally {
                sandbox.dispose();
            }
        }
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error(`architect-mcp started with ${registeredTools.size} tools.`);
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
