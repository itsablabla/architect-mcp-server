import {
    Capability,
    CustomTool,
    ToolPermission
} from "../types.js";
import { findMissingCapabilities } from "./capabilities.js";
import { getDb } from "./db.js";

export async function getToolPermissions(toolName: string): Promise<ToolPermission | null> {
    const db = getDb();
    const row = db.prepare("SELECT * FROM permissions WHERE tool_name = ?").get(toolName) as any;
    if (!row) return null;
    return {
        toolName: row.tool_name,
        toolVersion: row.tool_version,
        approvedCapabilities: JSON.parse(row.approved_capabilities),
        approvedAt: row.approved_at
    };
}

export async function checkToolApproval(
    tool: CustomTool
): Promise<{ approved: boolean; missing: Capability[] }> {
    if (tool.capabilities.length === 0) {
        return { approved: true, missing: [] };
    }

    const permission = await getToolPermissions(tool.name);

    if (!permission) {
        return { approved: false, missing: tool.capabilities };
    }

    const missing = findMissingCapabilities(
        tool.capabilities,
        permission.approvedCapabilities
    );

    return {
        approved: missing.length === 0,
        missing
    };
}

export async function approveToolCapabilities(
    toolName: string,
    toolVersion: number,
    capabilities: Capability[]
): Promise<void> {
    const db = getDb();
    db.prepare(
        `INSERT OR REPLACE INTO permissions (tool_name, tool_version, approved_capabilities, approved_at)
         VALUES (?, ?, ?, ?)`
    ).run(toolName, toolVersion, JSON.stringify(capabilities), new Date().toISOString());
}

export async function revokeToolPermissions(toolName: string): Promise<void> {
    const db = getDb();
    db.prepare("DELETE FROM permissions WHERE tool_name = ?").run(toolName);
}

export async function listAllPermissions(): Promise<ToolPermission[]> {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM permissions").all() as any[];
    return rows.map(row => ({
        toolName: row.tool_name,
        toolVersion: row.tool_version,
        approvedCapabilities: JSON.parse(row.approved_capabilities),
        approvedAt: row.approved_at
    }));
}

export function isApprovalStale(tool: CustomTool, permission: ToolPermission): boolean {
    if (permission.toolVersion !== tool.version) {
        const missing = findMissingCapabilities(
            tool.capabilities,
            permission.approvedCapabilities
        );
        return missing.length > 0;
    }
    return false;
}
