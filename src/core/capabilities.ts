import {
    Capability,
    NetCapability,
    NetEndpointScope,
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
                const netRest = parts[1];
                const hashIdx = netRest.indexOf("#");
                if (hashIdx === -1) {
                    cap.domains = netRest.split(",").map(d => d.trim()).filter(Boolean);
                } else {
                    const domainPart = netRest.slice(0, hashIdx);
                    const scopePart = netRest.slice(hashIdx + 1);
                    if (domainPart) {
                        cap.domains = domainPart.split(",").map(d => d.trim()).filter(Boolean);
                    }
                    const slashIdx = scopePart.indexOf("/");
                    const methodStr = slashIdx === -1 ? scopePart : scopePart.slice(0, slashIdx);
                    const pathStr = slashIdx === -1 ? undefined : scopePart.slice(slashIdx);
                    const methods = methodStr.split(",").map(m => m.trim().toUpperCase()).filter(Boolean);
                    if (methods.length > 0) {
                        cap.allowedMethods = methods;
                    }
                    if (pathStr && cap.domains && cap.domains.length > 0) {
                        cap.endpoints = {};
                        for (const domain of cap.domains) {
                            const scope: NetEndpointScope = {};
                            if (methods.length > 0) scope.methods = methods;
                            scope.pathPattern = pathStr;
                            cap.endpoints[domain] = scope;
                        }
                    }
                }
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
        case "net": {
            const domainStr = cap.domains?.length ? cap.domains.join(",") : "";
            const firstEndpoint = cap.endpoints && cap.domains?.length
                ? cap.endpoints[cap.domains[0]]
                : undefined;
            const methodStr = cap.allowedMethods?.length ? cap.allowedMethods.join(",") : "";
            const pathStr = firstEndpoint?.pathPattern ?? "";
            if (!domainStr) return "net";
            if (!methodStr && !pathStr) return `net:${domainStr}`;
            if (!pathStr) return `net:${domainStr}#${methodStr}`;
            return `net:${domainStr}#${methodStr}${pathStr}`;
        }
        case "fs": {
            const pathStr = cap.paths?.length ? `:${cap.paths.join(",")}` : "";
            return `fs:${cap.mode}${pathStr}`;
        }
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
            if (!req.domains.every(d => granted.domains!.includes(d))) {
                return false;
            }
            if (granted.allowedMethods?.length) {
                if (!req.allowedMethods?.length) return false;
                if (!req.allowedMethods.every(m => granted.allowedMethods!.includes(m))) return false;
            }
            return true;
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
        case "net": {
            if (!cap.domains?.length) return "NETWORK (all domains)";
            let desc = `NETWORK (domains: ${cap.domains.join(", ")})`;
            if (cap.allowedMethods?.length) {
                desc += ` [methods: ${cap.allowedMethods.join(", ")}]`;
            }
            const firstDomain = cap.domains[0];
            const scope = cap.endpoints?.[firstDomain];
            if (scope?.pathPattern) {
                desc += ` [path: ${scope.pathPattern}]`;
            }
            return desc;
        }

        case "fs": {
            const modeStr = cap.mode.toUpperCase().replace("_", "/");
            if (cap.paths?.length) {
                return `FILESYSTEM ${modeStr} (paths: ${cap.paths.join(", ")})`;
            }
            return `FILESYSTEM ${modeStr} (all paths)`;
        }

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
