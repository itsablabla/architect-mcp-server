import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import {
    Capability,
    CustomTool,
    PermissionsStore,
    ToolPermission
} from "../types.js";
import { findMissingCapabilities } from "./capabilities.js";
import { fileExists } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERMISSIONS_FILE = path.resolve(__dirname, "..", "permissions.json");
const PERMISSIONS_SCHEMA_VERSION = 1;



export async function loadPermissions(): Promise<PermissionsStore> {
    if (!await fileExists(PERMISSIONS_FILE)) {
        return {
            version: PERMISSIONS_SCHEMA_VERSION,
            permissions: {}
        };
    }

    try {
        const content = await fs.readFile(PERMISSIONS_FILE, "utf-8");
        const data = JSON.parse(content) as PermissionsStore;
        return {
            version: data.version || PERMISSIONS_SCHEMA_VERSION,
            permissions: data.permissions || {}
        };
    } catch {
        return {
            version: PERMISSIONS_SCHEMA_VERSION,
            permissions: {}
        };
    }
}

export async function savePermissions(store: PermissionsStore): Promise<void> {
    await fs.writeFile(PERMISSIONS_FILE, JSON.stringify(store, null, 2));
}

export async function getToolPermissions(toolName: string): Promise<ToolPermission | null> {
    const store = await loadPermissions();
    return store.permissions[toolName] || null;
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
    const store = await loadPermissions();

    store.permissions[toolName] = {
        toolName,
        toolVersion,
        approvedCapabilities: capabilities,
        approvedAt: new Date().toISOString()
    };

    await savePermissions(store);
}

export async function revokeToolPermissions(toolName: string): Promise<void> {
    const store = await loadPermissions();
    delete store.permissions[toolName];
    await savePermissions(store);
}

export async function listAllPermissions(): Promise<ToolPermission[]> {
    const store = await loadPermissions();
    return Object.values(store.permissions);
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
