import { spawn } from "child_process";

export interface BrowserResult {
    success: boolean;
    data?: any;
    text?: string;
    error?: string;
    raw?: string;
}

export interface BrowserOptions {
    session?: string;
    sessionName?: string;
    profile?: string;
    headed?: boolean;
    headers?: Record<string, string>;
    allowedDomains?: string;
    contentBoundaries?: boolean;
    maxOutput?: number;
    ignoreHttpsErrors?: boolean;
    proxy?: string;
    userAgent?: string;
    cdp?: string | number;
    provider?: string;
}

function buildGlobalFlags(opts: BrowserOptions): string[] {
    const flags: string[] = [];
    if (opts.session) flags.push("--session", opts.session);
    if (opts.sessionName) flags.push("--session-name", opts.sessionName);
    if (opts.profile) flags.push("--profile", opts.profile);
    if (opts.headed) flags.push("--headed");
    if (opts.headers) flags.push("--headers", JSON.stringify(opts.headers));
    if (opts.allowedDomains) flags.push("--allowed-domains", opts.allowedDomains);
    if (opts.contentBoundaries) flags.push("--content-boundaries");
    if (opts.maxOutput) flags.push("--max-output", String(opts.maxOutput));
    if (opts.ignoreHttpsErrors) flags.push("--ignore-https-errors");
    if (opts.proxy) flags.push("--proxy", opts.proxy);
    if (opts.userAgent) flags.push("--user-agent", opts.userAgent);
    if (opts.cdp) flags.push("--cdp", String(opts.cdp));
    if (opts.provider) flags.push("-p", opts.provider);
    return flags;
}

export function runBrowserCommand(
    args: string[],
    opts: BrowserOptions = {},
    timeoutMs = 30000
): Promise<BrowserResult> {
    return new Promise((resolve) => {
        const globalFlags = buildGlobalFlags(opts);
        const finalArgs = [...globalFlags, ...args, "--json"];

        let stdout = "";
        let stderr = "";

        const proc = spawn("agent-browser", finalArgs, {
            timeout: timeoutMs,
            env: { ...process.env }
        });

        proc.stdout?.on("data", (d) => { stdout += d.toString(); });
        proc.stderr?.on("data", (d) => { stderr += d.toString(); });

        proc.on("close", (code) => {
            const raw = stdout.trim();
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") {
                    if (parsed.success === false) {
                        resolve({ success: false, error: parsed.error || parsed.message || "Command failed", raw });
                    } else {
                        resolve({ success: true, data: parsed.data ?? parsed, text: raw, raw });
                    }
                    return;
                }
            } catch { /* not JSON */ }

            if (code !== 0) {
                resolve({ success: false, error: stderr.trim() || `Exit code ${code}`, raw });
            } else {
                resolve({ success: true, text: raw, raw });
            }
        });

        proc.on("error", (err) => {
            resolve({
                success: false,
                error: err.message.includes("ENOENT")
                    ? "agent-browser not found. Install with: npm install -g agent-browser && agent-browser install"
                    : err.message
            });
        });
    });
}

function formatResult(r: BrowserResult): string {
    if (!r.success) return `Error: ${r.error}`;
    if (r.data !== undefined) return JSON.stringify(r.data, null, 2);
    return r.text ?? "OK";
}

function parseOpts(p: Record<string, any>): BrowserOptions {
    return {
        session: p.session,
        sessionName: p.session_name,
        profile: p.profile,
        headed: p.headed,
        headers: p.headers,
        allowedDomains: p.allowed_domains,
        contentBoundaries: p.content_boundaries,
        maxOutput: p.max_output,
        ignoreHttpsErrors: p.ignore_https_errors,
        proxy: p.proxy,
        userAgent: p.user_agent,
        cdp: p.cdp,
        provider: p.provider,
    };
}

export async function browserOpen(p: Record<string, any>): Promise<string> {
    const args = ["open", p.url];
    if (p.wait_until) args.push("--wait-until", p.wait_until);
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserSnapshot(p: Record<string, any>): Promise<string> {
    const args = ["snapshot"];
    if (p.interactive) args.push("-i");
    if (p.cursor) args.push("-C");
    if (p.compact) args.push("-c");
    if (p.depth) args.push("-d", String(p.depth));
    if (p.selector) args.push("-s", p.selector);
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserBack(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["back"], parseOpts(p)));
}

export async function browserForward(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["forward"], parseOpts(p)));
}

export async function browserReload(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["reload"], parseOpts(p)));
}

export async function browserClick(p: Record<string, any>): Promise<string> {
    const args = ["click", p.selector];
    if (p.new_tab) args.push("--new-tab");
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserDblclick(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["dblclick", p.selector], parseOpts(p)));
}

export async function browserFocus(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["focus", p.selector], parseOpts(p)));
}

export async function browserType(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["type", p.selector, p.text], parseOpts(p)));
}

export async function browserFill(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["fill", p.selector, p.value], parseOpts(p)));
}

export async function browserPress(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["press", p.key], parseOpts(p)));
}

export async function browserKeyboardType(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["keyboard", "type", p.text], parseOpts(p)));
}

export async function browserKeyboardInsertText(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["keyboard", "inserttext", p.text], parseOpts(p)));
}

export async function browserKeydown(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["keydown", p.key], parseOpts(p)));
}

export async function browserKeyup(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["keyup", p.key], parseOpts(p)));
}

export async function browserHover(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["hover", p.selector], parseOpts(p)));
}

export async function browserSelect(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["select", p.selector, p.value], parseOpts(p)));
}

export async function browserCheck(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["check", p.selector], parseOpts(p)));
}

export async function browserUncheck(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["uncheck", p.selector], parseOpts(p)));
}

export async function browserScroll(p: Record<string, any>): Promise<string> {
    const args = ["scroll", p.direction];
    if (p.pixels) args.push(String(p.pixels));
    if (p.selector) args.push("--selector", p.selector);
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserScrollIntoView(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["scrollintoview", p.selector], parseOpts(p)));
}

export async function browserDrag(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["drag", p.source, p.target], parseOpts(p)));
}

export async function browserUpload(p: Record<string, any>): Promise<string> {
    const files = Array.isArray(p.files) ? p.files : [p.files];
    return formatResult(await runBrowserCommand(["upload", p.selector, ...files], parseOpts(p)));
}

export async function browserScreenshot(p: Record<string, any>): Promise<string> {
    const args = ["screenshot"];
    if (p.path) args.push(p.path);
    if (p.full) args.push("--full");
    if (p.annotate) args.push("--annotate");
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserPdf(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["pdf", p.path], parseOpts(p)));
}

export async function browserGetText(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["get", "text", p.selector], parseOpts(p)));
}

export async function browserGetHtml(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["get", "html", p.selector], parseOpts(p)));
}

export async function browserGetValue(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["get", "value", p.selector], parseOpts(p)));
}

export async function browserGetAttr(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["get", "attr", p.selector, p.attribute], parseOpts(p)));
}

export async function browserGetTitle(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["get", "title"], parseOpts(p)));
}

export async function browserGetUrl(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["get", "url"], parseOpts(p)));
}

export async function browserGetCount(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["get", "count", p.selector], parseOpts(p)));
}

export async function browserGetBox(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["get", "box", p.selector], parseOpts(p)));
}

export async function browserGetStyles(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["get", "styles", p.selector], parseOpts(p)));
}

export async function browserIsVisible(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["is", "visible", p.selector], parseOpts(p)));
}

export async function browserIsEnabled(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["is", "enabled", p.selector], parseOpts(p)));
}

export async function browserIsChecked(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["is", "checked", p.selector], parseOpts(p)));
}

export async function browserFind(p: Record<string, any>): Promise<string> {
    const args = ["find", p.by, p.value, p.action];
    if (p.action_value) args.push(p.action_value);
    if (p.name) args.push("--name", p.name);
    if (p.exact) args.push("--exact");
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserWait(p: Record<string, any>): Promise<string> {
    const args = ["wait"];
    if (p.selector) args.push(p.selector);
    else if (p.ms) args.push(String(p.ms));
    if (p.text) args.push("--text", p.text);
    if (p.url) args.push("--url", p.url);
    if (p.load) args.push("--load", p.load);
    if (p.fn) args.push("--fn", p.fn);
    return formatResult(await runBrowserCommand(args, parseOpts(p), 60000));
}

export async function browserEval(p: Record<string, any>): Promise<string> {
    const args = ["eval", p.code];
    if (p.base64) args.push("-b");
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserMouseMove(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["mouse", "move", String(p.x), String(p.y)], parseOpts(p)));
}

export async function browserMouseDown(p: Record<string, any>): Promise<string> {
    const args = ["mouse", "down"];
    if (p.button) args.push(p.button);
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserMouseUp(p: Record<string, any>): Promise<string> {
    const args = ["mouse", "up"];
    if (p.button) args.push(p.button);
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserMouseWheel(p: Record<string, any>): Promise<string> {
    const args = ["mouse", "wheel", String(p.dy)];
    if (p.dx) args.push(String(p.dx));
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserSetViewport(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["set", "viewport", String(p.width), String(p.height)], parseOpts(p)));
}

export async function browserSetDevice(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["set", "device", p.device], parseOpts(p)));
}

export async function browserSetGeo(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["set", "geo", String(p.lat), String(p.lng)], parseOpts(p)));
}

export async function browserSetOffline(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["set", "offline", p.enabled !== false ? "on" : "off"], parseOpts(p)));
}

export async function browserSetHeaders(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["set", "headers", JSON.stringify(p.headers)], parseOpts(p)));
}

export async function browserSetCredentials(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["set", "credentials", p.username, p.password], parseOpts(p)));
}

export async function browserSetMedia(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["set", "media", p.scheme], parseOpts(p)));
}

export async function browserCookiesGet(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["cookies"], parseOpts(p)));
}

export async function browserCookiesSet(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["cookies", "set", p.name, p.value], parseOpts(p)));
}

export async function browserCookiesClear(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["cookies", "clear"], parseOpts(p)));
}

export async function browserStorageGet(p: Record<string, any>): Promise<string> {
    const args = ["storage", p.type || "local"];
    if (p.key) args.push(p.key);
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserStorageSet(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["storage", p.type || "local", "set", p.key, p.value], parseOpts(p)));
}

export async function browserStorageClear(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["storage", p.type || "local", "clear"], parseOpts(p)));
}

export async function browserNetworkRoute(p: Record<string, any>): Promise<string> {
    const args = ["network", "route", p.url];
    if (p.abort) args.push("--abort");
    if (p.body) args.push("--body", JSON.stringify(p.body));
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserNetworkUnroute(p: Record<string, any>): Promise<string> {
    const args = ["network", "unroute"];
    if (p.url) args.push(p.url);
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserNetworkRequests(p: Record<string, any>): Promise<string> {
    const args = ["network", "requests"];
    if (p.filter) args.push("--filter", p.filter);
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserTabList(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["tab"], parseOpts(p)));
}

export async function browserTabNew(p: Record<string, any>): Promise<string> {
    const args = ["tab", "new"];
    if (p.url) args.push(p.url);
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserTabSwitch(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["tab", String(p.index)], parseOpts(p)));
}

export async function browserTabClose(p: Record<string, any>): Promise<string> {
    const args = ["tab", "close"];
    if (p.index !== undefined) args.push(String(p.index));
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserWindowNew(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["window", "new"], parseOpts(p)));
}

export async function browserFrame(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["frame", p.selector || "main"], parseOpts(p)));
}

export async function browserDialogAccept(p: Record<string, any>): Promise<string> {
    const args = ["dialog", "accept"];
    if (p.text) args.push(p.text);
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserDialogDismiss(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["dialog", "dismiss"], parseOpts(p)));
}

export async function browserDiffSnapshot(p: Record<string, any>): Promise<string> {
    const args = ["diff", "snapshot"];
    if (p.baseline) args.push("--baseline", p.baseline);
    if (p.selector) args.push("--selector", p.selector);
    if (p.compact) args.push("--compact");
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserDiffScreenshot(p: Record<string, any>): Promise<string> {
    const args = ["diff", "screenshot", "--baseline", p.baseline];
    if (p.output) args.push("-o", p.output);
    if (p.threshold !== undefined) args.push("-t", String(p.threshold));
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserDiffUrl(p: Record<string, any>): Promise<string> {
    const args = ["diff", "url", p.url1, p.url2];
    if (p.screenshot) args.push("--screenshot");
    if (p.selector) args.push("--selector", p.selector);
    if (p.wait_until) args.push("--wait-until", p.wait_until);
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserConsole(p: Record<string, any>): Promise<string> {
    const args = ["console"];
    if (p.clear) args.push("--clear");
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserPageErrors(p: Record<string, any>): Promise<string> {
    const args = ["errors"];
    if (p.clear) args.push("--clear");
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserHighlight(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["highlight", p.selector], parseOpts(p)));
}

export async function browserTraceStart(p: Record<string, any>): Promise<string> {
    const args = ["trace", "start"];
    if (p.path) args.push(p.path);
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserTraceStop(p: Record<string, any>): Promise<string> {
    const args = ["trace", "stop"];
    if (p.path) args.push(p.path);
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserStateSave(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["state", "save", p.path], parseOpts(p)));
}

export async function browserStateLoad(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["state", "load", p.path], parseOpts(p)));
}

export async function browserStateList(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["state", "list"], parseOpts(p)));
}

export async function browserStateClear(p: Record<string, any>): Promise<string> {
    const args = ["state", "clear"];
    if (p.all) args.push("--all");
    else if (p.name) args.push(p.name);
    return formatResult(await runBrowserCommand(args, parseOpts(p)));
}

export async function browserSessionList(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["session", "list"], parseOpts(p)));
}

export async function browserAuthLogin(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["auth", "login", p.name], parseOpts(p)));
}

export async function browserConnect(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["connect", String(p.port)], parseOpts(p)));
}

export async function browserClose(p: Record<string, any>): Promise<string> {
    return formatResult(await runBrowserCommand(["close"], parseOpts(p)));
}
