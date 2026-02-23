import { z } from "zod";

export type CapabilityType = "net" | "fs" | "child_process" | "env";

export interface NetEndpointScope {
    methods?: string[];
    pathPattern?: string;
}

export interface NetCapability {
    type: "net";
    domains?: string[];
    allowedMethods?: string[];
    endpoints?: Record<string, NetEndpointScope>;
}

export interface FsCapability {
    type: "fs";
    mode: "read" | "write" | "read_write";
    paths?: string[];
}

export interface ChildProcessCapability {
    type: "child_process";
    commands?: string[];
}

export interface EnvCapability {
    type: "env";
    variables?: string[];
}

export type Capability =
    | NetCapability
    | FsCapability
    | ChildProcessCapability
    | EnvCapability;

export type ToolCategory =
    | "api"
    | "file"
    | "data"
    | "utility"
    | "automation"
    | "integration"
    | "other";

export interface RateLimitConfig {
    maxCallsPerMinute: number;
    maxCallsPerHour: number;
}

export interface ExecutionStats {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    totalDurationMs: number;
    lastExecutedAt?: string;
    averageDurationMs: number;
}

export interface RetryConfig {
    maxAttempts: number;
    backoff: "linear" | "exponential";
    initialDelayMs: number;
    maxDelayMs: number;
}

export interface CacheConfig {
    ttlSeconds: number;
    keyFields?: string[];
}

export interface TestCase {
    name: string;
    input: Record<string, unknown>;
    expect?: any;
    expectError?: string;
    timeout?: number;
}

export interface CustomTool {
    name: string;
    description: string;
    schema: JsonSchema;
    code: string;
    createdAt: string;
    updatedAt: string;
    version: number;
    capabilities: Capability[];
    category?: ToolCategory;
    tags?: string[];
    dependencies?: string[];
    rateLimit?: RateLimitConfig;
    author?: string;
    cache?: CacheConfig;
    retry?: RetryConfig;
    tests?: TestCase[];
    failingSince?: string;
    deprecated?: boolean;
}

export interface JsonSchema {
    type: string;
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
    additionalProperties?: boolean;
}

export interface JsonSchemaProperty {
    type: string;
    description?: string;
    enum?: string[];
    default?: any;
    items?: JsonSchemaProperty;
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
}

export interface ToolListItem {
    name: string;
    description: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    capabilities: Capability[];
    category?: ToolCategory;
    tags?: string[];
    deprecated?: boolean;
}

export interface ToolPermission {
    toolName: string;
    toolVersion: number;
    approvedCapabilities: Capability[];
    approvedAt: string;
}

export interface PermissionsStore {
    version: number;
    permissions: Record<string, ToolPermission>;
}

export interface ExecutionHistoryStore {
    version: number;
    stats: Record<string, ExecutionStats>;
    rateLimitState: Record<string, RateLimitState>;
}

export interface RateLimitState {
    minuteCalls: number[];
    hourCalls: number[];
}

export interface ToolTemplate {
    id: string;
    name: string;
    description: string;
    category: ToolCategory;
    schema: JsonSchema;
    code: string;
    capabilities: Capability[];
    tags: string[];
}

export interface ExportedTool {
    formatVersion: number;
    exportedAt: string;
    tool: CustomTool;
    permissions?: ToolPermission;
}

export interface ExportedToolBundle {
    formatVersion: number;
    exportedAt: string;
    tools: ExportedTool[];
}

export interface ToolVersion {
    version: number;
    tool: CustomTool;
    savedAt: string;
}

export interface VersionStore {
    toolName: string;
    versions: ToolVersion[];
}

export interface ScheduleConfig {
    id: string;
    toolName: string;
    cron: string;
    params: Record<string, unknown>;
    enabled: boolean;
    lastRun?: string;
    nextRun?: string;
    createdAt: string;
}

export interface ScheduleStore {
    version: number;
    schedules: Record<string, ScheduleConfig>;
}

export interface WebhookConfig {
    id: string;
    toolName: string;
    path: string;
    method: "GET" | "POST";
    secret?: string;
    enabled: boolean;
    createdAt: string;
}

export interface WebhookStore {
    version: number;
    webhooks: Record<string, WebhookConfig>;
}

export interface PipelineStep {
    tool: string;
    params: Record<string, unknown>;
    outputAs?: string;
    condition?: string;
}

export interface Pipeline {
    name: string;
    description: string;
    steps: PipelineStep[];
    createdAt: string;
    updatedAt: string;
}

export interface PipelineStore {
    version: number;
    pipelines: Record<string, Pipeline>;
}

export interface SecretEntry {
    name: string;
    encryptedValue: string;
    iv: string;
    createdAt: string;
    updatedAt: string;
}

export interface SecretsStore {
    version: number;
    secrets: Record<string, SecretEntry>;
}

export interface CacheEntry {
    key: string;
    result: any;
    cachedAt: string;
    expiresAt: string;
    toolName: string;
}

export interface CacheStore {
    version: number;
    entries: Record<string, CacheEntry>;
    stats: {
        hits: number;
        misses: number;
    };
}

export interface TestResult {
    name: string;
    passed: boolean;
    actual?: any;
    expected?: any;
    error?: string;
    durationMs: number;
}

export interface TestRunResult {
    toolName: string;
    totalTests: number;
    passed: number;
    failed: number;
    results: TestResult[];
    durationMs: number;
}

export interface CustomResource {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
    content: string;
    createdAt: string;
    updatedAt: string;
}

export interface ResourceStore {
    version: number;
    resources: Record<string, CustomResource>;
}

export interface PromptArgument {
    name: string;
    description: string;
    required: boolean;
}

export interface CustomPrompt {
    name: string;
    description: string;
    arguments: PromptArgument[];
    template: string;
    createdAt: string;
    updatedAt: string;
}

export interface PromptStore {
    version: number;
    prompts: Record<string, CustomPrompt>;
}

export interface MarketplaceEntry {
    id: string;
    name: string;
    description: string;
    author: string;
    version: string;
    category: ToolCategory;
    tags: string[];
    exportedTool: ExportedTool;
    exportedAt: string;
    owner_id?: number;
    owner_login?: string;
    installs?: number;
    failureReports?: number;
    successRate?: number;
    usageStats?: {
        totalCalls: number;
        successfulCalls: number;
        failedCalls: number;
        averageDurationMs: number;
        lastPublishedAt: string;
    };
}

export interface ToolAlias {
    alias: string;
    targetTool: string;
    presetParams: Record<string, unknown>;
    description?: string;
    createdAt: string;
}

export interface AliasStore {
    version: number;
    aliases: Record<string, ToolAlias>;
}

export interface BatchResult {
    input: Record<string, unknown>;
    output: any;
    success: boolean;
    error?: string;
    durationMs: number;
}

export interface BatchExecutionResult {
    toolName: string;
    results: BatchResult[];
    totalMs: number;
    successCount: number;
    failCount: number;
}

export const TOOL_CATEGORIES: ToolCategory[] = [
    "api",
    "file",
    "data",
    "utility",
    "automation",
    "integration",
    "other"
];

export const RESERVED_TOOL_NAMES = [
    "create_tool",
    "save_tool",
    "list_tools",
    "delete_tool",
    "get_tool_source",
    "update_tool",
    "reload_tools",
    "approve_tool",
    "revoke_permissions",
    "list_permissions",
    "validate_tool",
    "get_tool_stats",
    "export_tool",
    "import_tool",
    "list_templates",
    "create_from_template",
    "get_audit_logs",
    "clear_audit_logs",
    "call_tool",
    "list_versions",
    "rollback_tool",
    "diff_versions",
    "schedule_tool",
    "unschedule_tool",
    "list_schedules",
    "run_scheduled",
    "create_webhook",
    "delete_webhook",
    "list_webhooks",
    "create_pipeline",
    "run_pipeline",
    "list_pipelines",
    "delete_pipeline",
    "set_secret",
    "get_secret",
    "delete_secret",
    "list_secrets",
    "clear_cache",
    "cache_stats",
    "get_cache_stats",
    "run_tests",
    "run_all_tests",
    "create_resource",
    "delete_resource",
    "list_resources",
    "get_resource",
    "create_prompt",
    "delete_prompt",
    "list_prompts",
    "get_prompt",
    "render_prompt",
    "export_to_marketplace",
    "import_from_marketplace",
    "list_marketplace",
    "marketplace_export",
    "marketplace_import",
    "marketplace_list",
    "marketplace_delete",
    "marketplace_publish",
    "marketplace_browse",
    "marketplace_install_remote",
    "marketplace_delete_remote",
    "report_tool_issue",
    "publish_tool_stats",
    "batch_execute",
    "create_alias",
    "delete_alias",
    "execute_alias",
    "list_aliases",
    "search_tools",
    "get_tool_graph",
    "match_intent",
    "mark_tool_deprecated",
    "create_persona",
    "list_personas",
    "activate_persona",
    "delete_persona",
    "update_persona",
    "knowledge_cache_stats",
    "clear_knowledge_cache",
    "get_anomalies",
    "run_anomaly_check",
    "clear_anomaly",
    "reset_anomaly_baseline",
    "get_mutation_proposals",
    "get_mutation_context",
    "set_memory",
    "get_memory",
    "delete_memory",
    "list_memory",
    "clear_memory",
    "create_schedule",
    "delete_schedule"
] as const;

export type ReservedToolName = typeof RESERVED_TOOL_NAMES[number];

export function isReservedToolName(name: string): name is ReservedToolName {
    return RESERVED_TOOL_NAMES.includes(name as ReservedToolName);
}

export function validateToolName(name: string): { valid: boolean; error?: string } {
    if (!name || name.trim().length === 0) {
        return { valid: false, error: "Tool name cannot be empty" };
    }
    if (name.length > 64) {
        return { valid: false, error: "Tool name cannot exceed 64 characters" };
    }
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
        return { valid: false, error: "Tool name must start with lowercase letter and contain only lowercase letters, numbers, and underscores" };
    }
    if (isReservedToolName(name)) {
        return { valid: false, error: `Tool name '${name}' is reserved` };
    }
    return { valid: true };
}

export function jsonSchemaToZod(schema: JsonSchema): z.ZodType<any> {
    if (!schema || !schema.type) {
        return z.any();
    }

    if (schema.type === "object") {
        const shape: Record<string, z.ZodType<any>> = {};
        const properties = schema.properties || {};
        const required = schema.required || [];

        for (const [key, prop] of Object.entries(properties)) {
            let fieldSchema = jsonSchemaPropertyToZod(prop);
            if (!required.includes(key)) {
                fieldSchema = fieldSchema.optional();
            }
            shape[key] = fieldSchema;
        }

        return z.object(shape);
    }

    return z.any();
}

function jsonSchemaPropertyToZod(prop: JsonSchemaProperty): z.ZodType<any> {
    switch (prop.type) {
        case "string":
            if (prop.enum) {
                return z.enum(prop.enum as [string, ...string[]]);
            }
            return z.string();
        case "number":
        case "integer":
            return z.number();
        case "boolean":
            return z.boolean();
        case "array":
            if (prop.items) {
                return z.array(jsonSchemaPropertyToZod(prop.items));
            }
            return z.array(z.any());
        case "object":
            if (prop.properties) {
                const shape: Record<string, z.ZodType<any>> = {};
                const required = prop.required || [];
                for (const [key, subProp] of Object.entries(prop.properties)) {
                    let fieldSchema = jsonSchemaPropertyToZod(subProp);
                    if (!required.includes(key)) {
                        fieldSchema = fieldSchema.optional();
                    }
                    shape[key] = fieldSchema;
                }
                return z.object(shape);
            }
            return z.record(z.string(), z.any());
        case "null":
            return z.null();
        default:
            return z.any();
    }
}

export function migrateToolData(raw: any): CustomTool {
    return {
        ...raw,
        capabilities: raw.capabilities ?? [],
        category: raw.category ?? "other",
        tags: raw.tags ?? [],
        dependencies: raw.dependencies ?? [],
    };
}

export interface AgentPersona {
    name: string;
    description: string;
    tools: string[];
    systemPrompt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface MemoryEntry {
    key: string;
    namespace: string;
    value: string;
    createdAt: string;
    updatedAt: string;
    expiresAt?: string;
}

export interface MemoryStore {
    version: number;
    entries: Record<string, MemoryEntry>;
}

export interface AnomalyBaseline {
    avgDurationMs: number;
    failRate: number;
    sampledAt: string;
    totalCallsAtSample: number;
}

export interface AnomalyRecord {
    toolName: string;
    detectedAt: string;
    reasons: string[];
    baselineAvgDurationMs: number;
    currentAvgDurationMs: number;
    baselineFailRate: number;
    currentFailRate: number;
}

export interface AnomalyStore {
    version: number;
    baselines: Record<string, AnomalyBaseline>;
    anomalies: Record<string, AnomalyRecord>;
}

export interface MutationCandidate {
    toolName: string;
    anomaly: AnomalyRecord;
    suggestedAction: string;
    priority: "high" | "medium" | "low";
}

export interface MutationStore {
    version: number;
    candidates: Record<string, MutationCandidate>;
}

export interface IntentMatch {
    tool: ToolListItem;
    score: number;
    confidence: number;
    matchedTerms: string[];
}

export interface IntentResponse {
    query: string;
    matches: IntentMatch[];
    suggestions?: string[];
}


