import {
    Capability,
    NetCapability,
    FsCapability,
    ChildProcessCapability,
    EnvCapability,
    CapabilityType
} from "../types.js";

export interface ParsedCapability {
    capability: Capability;
    raw: string;
}

export function parseCapability(capString: string): ParsedCapability {
    const trimmed = capString.trim();
    const parts = trimmed.split(":");

    const type = parts[0] as CapabilityType;

    switch (type) {
        case "net": {
            const cap: NetCapability = { type: "net" };
            if (parts.length > 1 && parts[1]) {
                cap.domains = parts[1].split(",").map(d => d.trim()).filter(Boolean);
            }
            return { capability: cap, raw: trimmed };
        }

        case "fs": {
            const mode = (parts[1] as "read" | "write" | "read_write") || "read";
            const cap: FsCapability = { type: "fs", mode };
            if (parts.length > 2 && parts[2]) {
                cap.paths = parts[2].split(",").map(p => p.trim()).filter(Boolean);
            }
            return { capability: cap, raw: trimmed };
        }

        case "child_process": {
            const cap: ChildProcessCapability = { type: "child_process" };
            if (parts.length > 1 && parts[1]) {
                cap.commands = parts[1].split(",").map(c => c.trim()).filter(Boolean);
            }
            return { capability: cap, raw: trimmed };
        }

        case "env": {
            const cap: EnvCapability = { type: "env" };
            if (parts.length > 1 && parts[1]) {
                cap.variables = parts[1].split(",").map(v => v.trim()).filter(Boolean);
            }
            return { capability: cap, raw: trimmed };
        }

        default:
            throw new Error(`Unknown capability type: ${type}`);
    }
}

export function validateCapabilities(caps: Capability[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const seen = new Set<string>();

    for (const cap of caps) {
        const key = capabilityToString(cap);
        if (seen.has(cap.type)) {
            errors.push(`Duplicate capability type: ${cap.type}`);
        }
        seen.add(cap.type);

        if (cap.type === "fs") {
            const validModes = ["read", "write", "read_write"];
            if (!validModes.includes(cap.mode)) {
                errors.push(`Invalid fs mode: ${cap.mode}`);
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

export function capabilityToString(cap: Capability): string {
    switch (cap.type) {
        case "net":
            return cap.domains?.length ? `net:${cap.domains.join(",")}` : "net";
        case "fs":
            const pathStr = cap.paths?.length ? `:${cap.paths.join(",")}` : "";
            return `fs:${cap.mode}${pathStr}`;
        case "child_process":
            return cap.commands?.length ? `child_process:${cap.commands.join(",")}` : "child_process";
        case "env":
            return cap.variables?.length ? `env:${cap.variables.join(",")}` : "env";
    }
}

export function capabilitySatisfies(granted: Capability, requested: Capability): boolean {
    if (granted.type !== requested.type) {
        return false;
    }

    switch (granted.type) {
        case "net": {
            const req = requested as NetCapability;
            if (!granted.domains || granted.domains.length === 0) {
                return true;
            }
            if (!req.domains || req.domains.length === 0) {
                return false;
            }
            return req.domains.every(d => granted.domains!.includes(d));
        }

        case "fs": {
            const req = requested as FsCapability;
            const grantedFs = granted as FsCapability;

            if (grantedFs.mode === "read" && req.mode !== "read") {
                return false;
            }
            if (grantedFs.mode === "write" && req.mode !== "write") {
                return false;
            }

            if (!grantedFs.paths || grantedFs.paths.length === 0) {
                return true;
            }
            if (!req.paths || req.paths.length === 0) {
                return false;
            }
            return req.paths.every(rp =>
                grantedFs.paths!.some(gp => rp.startsWith(gp))
            );
        }

        case "child_process": {
            const req = requested as ChildProcessCapability;
            if (!granted.commands || granted.commands.length === 0) {
                return true;
            }
            if (!req.commands || req.commands.length === 0) {
                return false;
            }
            return req.commands.every(c => granted.commands!.includes(c));
        }

        case "env": {
            const req = requested as EnvCapability;
            if (!granted.variables || granted.variables.length === 0) {
                return true;
            }
            if (!req.variables || req.variables.length === 0) {
                return false;
            }
            return req.variables.every(v => granted.variables!.includes(v));
        }
    }
}

export function findMissingCapabilities(
    requested: Capability[],
    approved: Capability[]
): Capability[] {
    const missing: Capability[] = [];

    for (const req of requested) {
        const granted = approved.find(a => a.type === req.type);
        if (!granted || !capabilitySatisfies(granted, req)) {
            missing.push(req);
        }
    }

    return missing;
}

export function formatCapability(cap: Capability): string {
    switch (cap.type) {
        case "net":
            if (cap.domains?.length) {
                return `NETWORK (domains: ${cap.domains.join(", ")})`;
            }
            return "NETWORK (all domains)";

        case "fs":
            const modeStr = cap.mode.toUpperCase().replace("_", "/");
            if (cap.paths?.length) {
                return `FILESYSTEM ${modeStr} (paths: ${cap.paths.join(", ")})`;
            }
            return `FILESYSTEM ${modeStr} (all paths)`;

        case "child_process":
            if (cap.commands?.length) {
                return `SUBPROCESS (commands: ${cap.commands.join(", ")})`;
            }
            return "SUBPROCESS (all commands)";

        case "env":
            if (cap.variables?.length) {
                return `ENVIRONMENT (vars: ${cap.variables.join(", ")})`;
            }
            return "ENVIRONMENT (all variables)";
    }
}

export function formatCapabilities(caps: Capability[]): string {
    if (caps.length === 0) {
        return "  (none)";
    }
    return caps.map(c => `  - ${formatCapability(c)}`).join("\n");
}
