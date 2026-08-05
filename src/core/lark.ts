import { getSecret } from "./secrets.js";

/**
 * Lark / Feishu Open Platform client.
 *
 * Credentials are read from the encrypted secret store (set via the `store`
 * gateway): `LARK_APP_ID`, `LARK_APP_SECRET`, and optionally
 * `LARK_USER_ACCESS_TOKEN` for user-scoped calls. Override the API base with
 * `LARK_BASE_URL` (defaults to the international Lark endpoint; use
 * `https://open.feishu.cn/open-apis` for Feishu tenants).
 */

const DEFAULT_BASE_URL = "https://open.larksuite.com/open-apis";
const TOKEN_REFRESH_LEAD_MS = 60_000;

export type LarkTokenType = "tenant" | "user";

interface CachedToken {
    token: string;
    expiresAt: number;
}

let tenantTokenCache: CachedToken | null = null;

async function baseUrl(): Promise<string> {
    const override = await getSecret("LARK_BASE_URL");
    return (override || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export async function getLarkTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (tenantTokenCache && tenantTokenCache.expiresAt - TOKEN_REFRESH_LEAD_MS > now) {
        return tenantTokenCache.token;
    }

    const appId = await getSecret("LARK_APP_ID");
    const appSecret = await getSecret("LARK_APP_SECRET");
    if (!appId || !appSecret) {
        throw new Error(
            "Lark app credentials not set. Use store {action:\"set_secret\"} with names " +
            "'LARK_APP_ID' and 'LARK_APP_SECRET' (from open.larksuite.com / open.feishu.cn)."
        );
    }

    const base = await baseUrl();
    const res = await fetch(`${base}/auth/v3/tenant_access_token/internal`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data.tenant_access_token) {
        const msg = data?.msg || data?.message || `HTTP ${res.status}`;
        const code = data?.code !== undefined ? ` (code ${data.code})` : "";
        throw new Error(`Lark tenant_access_token request failed: ${msg}${code}`);
    }
    const expireSec = typeof data.expire === "number" ? data.expire : 7200;
    tenantTokenCache = { token: data.tenant_access_token, expiresAt: now + expireSec * 1000 };
    return tenantTokenCache.token;
}

export async function getLarkAccessToken(type: LarkTokenType = "tenant"): Promise<string> {
    if (type === "user") {
        const tok = await getSecret("LARK_USER_ACCESS_TOKEN");
        if (!tok) {
            throw new Error(
                "Lark user access token not set. Use store {action:\"set_secret\"} with name 'LARK_USER_ACCESS_TOKEN'."
            );
        }
        return tok;
    }
    return getLarkTenantAccessToken();
}

export interface LarkRequestOptions {
    path: string;
    method?: string;
    query?: Record<string, string | number | boolean | undefined | null>;
    body?: unknown;
    tokenType?: LarkTokenType;
    /** Override the Content-Type header (defaults to application/json when a body is sent). */
    contentType?: string;
}

export interface LarkResponse<T = unknown> {
    code: number;
    msg: string;
    data?: T;
    [key: string]: unknown;
}

/**
 * Issue an authenticated Lark Open Platform request and return the parsed
 * `data` payload. Throws on non-2xx responses or non-zero Lark error codes.
 */
export async function larkRequest<T = unknown>(opts: LarkRequestOptions): Promise<T> {
    const base = await baseUrl();
    const url = new URL(`${base}${opts.path}`);
    if (opts.query) {
        for (const [k, v] of Object.entries(opts.query)) {
            if (v === undefined || v === null || v === "") continue;
            url.searchParams.set(k, String(v));
        }
    }

    const token = await getLarkAccessToken(opts.tokenType ?? "tenant");
    const hasBody = opts.body !== undefined && opts.body !== null;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (hasBody) headers["Content-Type"] = opts.contentType || "application/json; charset=utf-8";

    const method = opts.method || (hasBody ? "POST" : "GET");
    const res = await fetch(url.toString(), {
        method,
        headers,
        body: hasBody ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
    });

    const text = await res.text();
    let payload: any;
    try {
        payload = text ? JSON.parse(text) : {};
    } catch {
        if (!res.ok) throw new Error(`Lark API error: HTTP ${res.status} (non-JSON response)`);
        return text as unknown as T;
    }

    if (!res.ok || (typeof payload.code === "number" && payload.code !== 0)) {
        const msg = payload.msg || payload.message || `HTTP ${res.status}`;
        const code = typeof payload.code === "number" ? ` (code ${payload.code})` : "";
        throw new Error(`Lark API error: ${msg}${code}`);
    }
    return (payload.data ?? payload) as T;
}

/** Drop the cached tenant token — useful after a 401 or credential rotation. */
export function invalidateLarkTenantToken(): void {
    tenantTokenCache = null;
}
