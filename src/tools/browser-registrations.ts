import {
    browserOpen, browserSnapshot, browserBack, browserForward, browserReload,
    browserClick, browserDblclick, browserFocus, browserType, browserFill,
    browserPress, browserKeyboardType, browserKeyboardInsertText,
    browserKeydown, browserKeyup, browserHover, browserSelect,
    browserCheck, browserUncheck, browserScroll, browserScrollIntoView,
    browserDrag, browserUpload, browserScreenshot, browserPdf,
    browserGetText, browserGetHtml, browserGetValue, browserGetAttr,
    browserGetTitle, browserGetUrl, browserGetCount, browserGetBox, browserGetStyles,
    browserIsVisible, browserIsEnabled, browserIsChecked,
    browserFind, browserWait, browserEval,
    browserMouseMove, browserMouseDown, browserMouseUp, browserMouseWheel,
    browserSetViewport, browserSetDevice, browserSetGeo, browserSetOffline,
    browserSetHeaders, browserSetCredentials, browserSetMedia,
    browserCookiesGet, browserCookiesSet, browserCookiesClear,
    browserStorageGet, browserStorageSet, browserStorageClear,
    browserNetworkRoute, browserNetworkUnroute, browserNetworkRequests,
    browserTabList, browserTabNew, browserTabSwitch, browserTabClose, browserWindowNew,
    browserFrame, browserDialogAccept, browserDialogDismiss,
    browserDiffSnapshot, browserDiffScreenshot, browserDiffUrl,
    browserConsole, browserPageErrors, browserHighlight,
    browserTraceStart, browserTraceStop,
    browserStateSave, browserStateLoad, browserStateList, browserStateClear,
    browserSessionList, browserAuthLogin, browserConnect, browserClose,
} from "./browser.js";

const SESSION_PROPS = {
    session: { type: "string", description: "Isolated browser session name" },
    session_name: { type: "string", description: "Auto-save/restore session state name" },
    profile: { type: "string", description: "Persistent browser profile directory path" },
    headed: { type: "boolean", description: "Show browser window (not headless)" },
    cdp: { type: "string", description: "Connect via CDP (port number or WebSocket URL)" },
    provider: { type: "string", description: "Cloud browser provider: browserbase | browseruse | kernel | ios" },
    allowed_domains: { type: "string", description: "Comma-separated allowed domain patterns" },
    content_boundaries: { type: "boolean", description: "Wrap page output in LLM safety boundary markers" },
    max_output: { type: "number", description: "Truncate page output to N characters" },
    ignore_https_errors: { type: "boolean", description: "Ignore HTTPS certificate errors" },
    proxy: { type: "string", description: "Proxy server URL" },
    user_agent: { type: "string", description: "Custom User-Agent string" },
};

export interface BrowserToolDefinition {
    name: string;
    description: string;
    inputSchema: { type: "object"; properties: Record<string, any>; required?: string[] };
    handler: (params: Record<string, any>) => Promise<string>;
}

export const BROWSER_TOOL_DEFINITIONS: BrowserToolDefinition[] = [

    {
        name: "browser_open",
        description: "Navigate to a URL. Returns the page after load. Use browser_snapshot after to see interactive elements.",
        inputSchema: {
            type: "object",
            properties: {
                url: { type: "string", description: "URL to navigate to" },
                wait_until: { type: "string", description: "Wait strategy: load | domcontentloaded | networkidle" },
                ...SESSION_PROPS,
            },
            required: ["url"],
        },
        handler: browserOpen,
    },
    {
        name: "browser_snapshot",
        description: "Get the current page accessibility tree with @ref handles for interacting with elements. Best first step after navigation.",
        inputSchema: {
            type: "object",
            properties: {
                interactive: { type: "boolean", description: "Only show interactive elements (buttons, inputs, links)" },
                cursor: { type: "boolean", description: "Include cursor-interactive elements (divs with onclick etc.)" },
                compact: { type: "boolean", description: "Remove empty structural elements" },
                depth: { type: "number", description: "Limit tree depth" },
                selector: { type: "string", description: "Scope snapshot to a CSS selector" },
                ...SESSION_PROPS,
            },
        },
        handler: browserSnapshot,
    },
    {
        name: "browser_back",
        description: "Go back in browser history.",
        inputSchema: { type: "object", properties: { ...SESSION_PROPS } },
        handler: browserBack,
    },
    {
        name: "browser_forward",
        description: "Go forward in browser history.",
        inputSchema: { type: "object", properties: { ...SESSION_PROPS } },
        handler: browserForward,
    },
    {
        name: "browser_reload",
        description: "Reload the current page.",
        inputSchema: { type: "object", properties: { ...SESSION_PROPS } },
        handler: browserReload,
    },

    {
        name: "browser_click",
        description: "Click an element. Use @ref from browser_snapshot (e.g. @e2) or CSS/text selectors.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref (@e1), CSS selector, or text=Submit" },
                new_tab: { type: "boolean", description: "Open link in a new tab" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserClick,
    },
    {
        name: "browser_dblclick",
        description: "Double-click an element.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref or selector" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserDblclick,
    },
    {
        name: "browser_focus",
        description: "Focus an element without clicking it.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref or selector" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserFocus,
    },
    {
        name: "browser_type",
        description: "Type text into an element (appends to existing content).",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref or selector" },
                text: { type: "string", description: "Text to type" },
                ...SESSION_PROPS,
            },
            required: ["selector", "text"],
        },
        handler: browserType,
    },
    {
        name: "browser_fill",
        description: "Clear and fill an input field. Preferred over browser_type for form inputs.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref or selector" },
                value: { type: "string", description: "Value to fill" },
                ...SESSION_PROPS,
            },
            required: ["selector", "value"],
        },
        handler: browserFill,
    },
    {
        name: "browser_press",
        description: "Press a keyboard key or shortcut (e.g. Enter, Tab, Control+a, Escape).",
        inputSchema: {
            type: "object",
            properties: {
                key: { type: "string", description: "Key name or shortcut (e.g. Enter, Tab, Control+a)" },
                ...SESSION_PROPS,
            },
            required: ["key"],
        },
        handler: browserPress,
    },
    {
        name: "browser_keyboard_type",
        description: "Type text using real keystrokes (no element selector, types at current focus).",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", description: "Text to type at current focus" },
                ...SESSION_PROPS,
            },
            required: ["text"],
        },
        handler: browserKeyboardType,
    },
    {
        name: "browser_keyboard_insert_text",
        description: "Insert text without triggering key events (no element selector). Faster than keyboard_type.",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", description: "Text to insert" },
                ...SESSION_PROPS,
            },
            required: ["text"],
        },
        handler: browserKeyboardInsertText,
    },
    {
        name: "browser_keydown",
        description: "Hold a key down.",
        inputSchema: {
            type: "object",
            properties: {
                key: { type: "string", description: "Key to hold down" },
                ...SESSION_PROPS,
            },
            required: ["key"],
        },
        handler: browserKeydown,
    },
    {
        name: "browser_keyup",
        description: "Release a held key.",
        inputSchema: {
            type: "object",
            properties: {
                key: { type: "string", description: "Key to release" },
                ...SESSION_PROPS,
            },
            required: ["key"],
        },
        handler: browserKeyup,
    },
    {
        name: "browser_hover",
        description: "Hover over an element (useful for revealing tooltips or dropdown menus).",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref or selector" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserHover,
    },
    {
        name: "browser_select",
        description: "Select an option in a <select> dropdown.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Select element ref or selector" },
                value: { type: "string", description: "Option value or text to select" },
                ...SESSION_PROPS,
            },
            required: ["selector", "value"],
        },
        handler: browserSelect,
    },
    {
        name: "browser_check",
        description: "Check a checkbox.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Checkbox element ref or selector" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserCheck,
    },
    {
        name: "browser_uncheck",
        description: "Uncheck a checkbox.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Checkbox element ref or selector" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserUncheck,
    },
    {
        name: "browser_scroll",
        description: "Scroll the page or a specific element in a direction.",
        inputSchema: {
            type: "object",
            properties: {
                direction: { type: "string", description: "Scroll direction: up | down | left | right" },
                pixels: { type: "number", description: "Number of pixels to scroll" },
                selector: { type: "string", description: "Scroll within this element instead of the page" },
                ...SESSION_PROPS,
            },
            required: ["direction"],
        },
        handler: browserScroll,
    },
    {
        name: "browser_scroll_into_view",
        description: "Scroll a specific element into the viewport.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref or selector to scroll into view" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserScrollIntoView,
    },
    {
        name: "browser_drag",
        description: "Drag an element from source to target.",
        inputSchema: {
            type: "object",
            properties: {
                source: { type: "string", description: "Source element ref or selector" },
                target: { type: "string", description: "Target element ref or selector" },
                ...SESSION_PROPS,
            },
            required: ["source", "target"],
        },
        handler: browserDrag,
    },
    {
        name: "browser_upload",
        description: "Upload one or more files to a file input element.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "File input element ref or selector" },
                files: { type: ["string", "array"], description: "File path(s) to upload" },
                ...SESSION_PROPS,
            },
            required: ["selector", "files"],
        },
        handler: browserUpload,
    },
    {
        name: "browser_screenshot",
        description: "Take a screenshot. Use --annotate to get numbered labels matching @refs for visual+text workflows.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Save path (optional, defaults to temp dir)" },
                full: { type: "boolean", description: "Capture full page (not just viewport)" },
                annotate: { type: "boolean", description: "Overlay numbered element labels matching @refs" },
                ...SESSION_PROPS,
            },
        },
        handler: browserScreenshot,
    },
    {
        name: "browser_pdf",
        description: "Save the current page as a PDF file.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Output file path for the PDF" },
                ...SESSION_PROPS,
            },
            required: ["path"],
        },
        handler: browserPdf,
    },

    {
        name: "browser_get_text",
        description: "Get the visible text content of an element.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref or selector" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserGetText,
    },
    {
        name: "browser_get_html",
        description: "Get the innerHTML of an element.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref or selector" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserGetHtml,
    },
    {
        name: "browser_get_value",
        description: "Get the current value of an input element.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Input element ref or selector" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserGetValue,
    },
    {
        name: "browser_get_attr",
        description: "Get the value of an HTML attribute on an element.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref or selector" },
                attribute: { type: "string", description: "Attribute name (e.g. href, src, data-id)" },
                ...SESSION_PROPS,
            },
            required: ["selector", "attribute"],
        },
        handler: browserGetAttr,
    },
    {
        name: "browser_get_title",
        description: "Get the current page title.",
        inputSchema: { type: "object", properties: { ...SESSION_PROPS } },
        handler: browserGetTitle,
    },
    {
        name: "browser_get_url",
        description: "Get the current page URL.",
        inputSchema: { type: "object", properties: { ...SESSION_PROPS } },
        handler: browserGetUrl,
    },
    {
        name: "browser_get_count",
        description: "Count how many elements match a selector.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "CSS selector" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserGetCount,
    },
    {
        name: "browser_get_box",
        description: "Get the bounding box (x, y, width, height) of an element.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref or selector" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserGetBox,
    },
    {
        name: "browser_get_styles",
        description: "Get the computed CSS styles of an element.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref or selector" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserGetStyles,
    },
    {
        name: "browser_is_visible",
        description: "Check whether an element is visible on the page.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref or selector" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserIsVisible,
    },
    {
        name: "browser_is_enabled",
        description: "Check whether an element is enabled (not disabled).",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref or selector" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserIsEnabled,
    },
    {
        name: "browser_is_checked",
        description: "Check whether a checkbox or radio button is checked.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Checkbox/radio element ref or selector" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserIsChecked,
    },
    {
        name: "browser_find",
        description: "Find elements using semantic locators (by ARIA role, text, label, placeholder, alt, testid, nth). More robust than CSS selectors.",
        inputSchema: {
            type: "object",
            properties: {
                by: { type: "string", description: "Locator type: role | text | label | placeholder | alt | title | testid | first | last | nth" },
                value: { type: "string", description: "Value to match (role name, text content, label text, etc.)" },
                action: { type: "string", description: "Action to perform: click | fill | type | hover | focus | check | uncheck | text" },
                action_value: { type: "string", description: "Value for fill/type actions" },
                name: { type: "string", description: "Filter by accessible name (for role locator)" },
                exact: { type: "boolean", description: "Require exact text match" },
                n: { type: "number", description: "Index for nth locator" },
                ...SESSION_PROPS,
            },
            required: ["by", "value", "action"],
        },
        handler: browserFind,
    },
    {
        name: "browser_wait",
        description: "Wait for an element, text, URL pattern, load state, or a time duration before continuing.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Wait for this element to be visible" },
                ms: { type: "number", description: "Wait for N milliseconds" },
                text: { type: "string", description: "Wait for this text to appear on page" },
                url: { type: "string", description: "Wait for URL to match this pattern (glob)" },
                load: { type: "string", description: "Wait for load state: load | domcontentloaded | networkidle" },
                fn: { type: "string", description: "Wait until this JS expression returns truthy" },
                ...SESSION_PROPS,
            },
        },
        handler: browserWait,
    },
    {
        name: "browser_eval",
        description: "Execute JavaScript in the context of the current page and return the result.",
        inputSchema: {
            type: "object",
            properties: {
                code: { type: "string", description: "JavaScript code to execute" },
                base64: { type: "boolean", description: "Code is base64-encoded" },
                ...SESSION_PROPS,
            },
            required: ["code"],
        },
        handler: browserEval,
    },
    {
        name: "browser_mouse_move",
        description: "Move the mouse cursor to specific coordinates.",
        inputSchema: {
            type: "object",
            properties: {
                x: { type: "number", description: "X coordinate" },
                y: { type: "number", description: "Y coordinate" },
                ...SESSION_PROPS,
            },
            required: ["x", "y"],
        },
        handler: browserMouseMove,
    },
    {
        name: "browser_mouse_down",
        description: "Press a mouse button down.",
        inputSchema: {
            type: "object",
            properties: {
                button: { type: "string", description: "Mouse button: left | right | middle" },
                ...SESSION_PROPS,
            },
        },
        handler: browserMouseDown,
    },
    {
        name: "browser_mouse_up",
        description: "Release a pressed mouse button.",
        inputSchema: {
            type: "object",
            properties: {
                button: { type: "string", description: "Mouse button: left | right | middle" },
                ...SESSION_PROPS,
            },
        },
        handler: browserMouseUp,
    },
    {
        name: "browser_mouse_wheel",
        description: "Scroll the mouse wheel.",
        inputSchema: {
            type: "object",
            properties: {
                dy: { type: "number", description: "Vertical scroll amount (positive = down)" },
                dx: { type: "number", description: "Horizontal scroll amount (positive = right)" },
                ...SESSION_PROPS,
            },
            required: ["dy"],
        },
        handler: browserMouseWheel,
    },
    {
        name: "browser_set_viewport",
        description: "Set the browser viewport size.",
        inputSchema: {
            type: "object",
            properties: {
                width: { type: "number", description: "Viewport width in pixels" },
                height: { type: "number", description: "Viewport height in pixels" },
                ...SESSION_PROPS,
            },
            required: ["width", "height"],
        },
        handler: browserSetViewport,
    },
    {
        name: "browser_set_device",
        description: "Emulate a device (e.g. 'iPhone 14', 'Pixel 5').",
        inputSchema: {
            type: "object",
            properties: {
                device: { type: "string", description: "Device name to emulate" },
                ...SESSION_PROPS,
            },
            required: ["device"],
        },
        handler: browserSetDevice,
    },
    {
        name: "browser_set_geo",
        description: "Set the browser's geolocation.",
        inputSchema: {
            type: "object",
            properties: {
                lat: { type: "number", description: "Latitude" },
                lng: { type: "number", description: "Longitude" },
                ...SESSION_PROPS,
            },
            required: ["lat", "lng"],
        },
        handler: browserSetGeo,
    },
    {
        name: "browser_set_offline",
        description: "Toggle offline mode on or off.",
        inputSchema: {
            type: "object",
            properties: {
                enabled: { type: "boolean", description: "true to go offline, false to restore network" },
                ...SESSION_PROPS,
            },
        },
        handler: browserSetOffline,
    },
    {
        name: "browser_set_headers",
        description: "Set global HTTP headers for all requests (all domains).",
        inputSchema: {
            type: "object",
            properties: {
                headers: { type: "object", description: "HTTP headers as key-value pairs", additionalProperties: { type: "string" } },
                ...SESSION_PROPS,
            },
            required: ["headers"],
        },
        handler: browserSetHeaders,
    },
    {
        name: "browser_set_credentials",
        description: "Set HTTP basic auth credentials.",
        inputSchema: {
            type: "object",
            properties: {
                username: { type: "string", description: "Username" },
                password: { type: "string", description: "Password" },
                ...SESSION_PROPS,
            },
            required: ["username", "password"],
        },
        handler: browserSetCredentials,
    },
    {
        name: "browser_set_media",
        description: "Emulate a CSS color scheme preference.",
        inputSchema: {
            type: "object",
            properties: {
                scheme: { type: "string", description: "Color scheme: dark | light | no-preference" },
                ...SESSION_PROPS,
            },
            required: ["scheme"],
        },
        handler: browserSetMedia,
    },
    {
        name: "browser_cookies_get",
        description: "Get all cookies for the current session.",
        inputSchema: { type: "object", properties: { ...SESSION_PROPS } },
        handler: browserCookiesGet,
    },
    {
        name: "browser_cookies_set",
        description: "Set a cookie.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Cookie name" },
                value: { type: "string", description: "Cookie value" },
                ...SESSION_PROPS,
            },
            required: ["name", "value"],
        },
        handler: browserCookiesSet,
    },
    {
        name: "browser_cookies_clear",
        description: "Clear all cookies.",
        inputSchema: { type: "object", properties: { ...SESSION_PROPS } },
        handler: browserCookiesClear,
    },
    {
        name: "browser_storage_get",
        description: "Get value(s) from localStorage or sessionStorage.",
        inputSchema: {
            type: "object",
            properties: {
                type: { type: "string", description: "Storage type: local | session (default: local)" },
                key: { type: "string", description: "Specific key to get (omit for all keys)" },
                ...SESSION_PROPS,
            },
        },
        handler: browserStorageGet,
    },
    {
        name: "browser_storage_set",
        description: "Set a value in localStorage or sessionStorage.",
        inputSchema: {
            type: "object",
            properties: {
                type: { type: "string", description: "Storage type: local | session (default: local)" },
                key: { type: "string", description: "Storage key" },
                value: { type: "string", description: "Value to store" },
                ...SESSION_PROPS,
            },
            required: ["key", "value"],
        },
        handler: browserStorageSet,
    },
    {
        name: "browser_storage_clear",
        description: "Clear all values from localStorage or sessionStorage.",
        inputSchema: {
            type: "object",
            properties: {
                type: { type: "string", description: "Storage type: local | session (default: local)" },
                ...SESSION_PROPS,
            },
        },
        handler: browserStorageClear,
    },
    {
        name: "browser_network_route",
        description: "Intercept, block, or mock network requests matching a URL pattern.",
        inputSchema: {
            type: "object",
            properties: {
                url: { type: "string", description: "URL pattern to intercept (glob)" },
                abort: { type: "boolean", description: "Block the request entirely" },
                body: { type: "object", description: "Mock response body (JSON)" },
                ...SESSION_PROPS,
            },
            required: ["url"],
        },
        handler: browserNetworkRoute,
    },
    {
        name: "browser_network_unroute",
        description: "Remove a network route/intercept.",
        inputSchema: {
            type: "object",
            properties: {
                url: { type: "string", description: "URL pattern to remove (omit to remove all)" },
                ...SESSION_PROPS,
            },
        },
        handler: browserNetworkUnroute,
    },
    {
        name: "browser_network_requests",
        description: "View tracked network requests made by the page.",
        inputSchema: {
            type: "object",
            properties: {
                filter: { type: "string", description: "Filter by keyword (e.g. 'api')" },
                ...SESSION_PROPS,
            },
        },
        handler: browserNetworkRequests,
    },
    {
        name: "browser_tab_list",
        description: "List all open browser tabs.",
        inputSchema: { type: "object", properties: { ...SESSION_PROPS } },
        handler: browserTabList,
    },
    {
        name: "browser_tab_new",
        description: "Open a new browser tab, optionally navigating to a URL.",
        inputSchema: {
            type: "object",
            properties: {
                url: { type: "string", description: "URL to open in the new tab (optional)" },
                ...SESSION_PROPS,
            },
        },
        handler: browserTabNew,
    },
    {
        name: "browser_tab_switch",
        description: "Switch to a tab by its index number.",
        inputSchema: {
            type: "object",
            properties: {
                index: { type: "number", description: "Tab index to switch to" },
                ...SESSION_PROPS,
            },
            required: ["index"],
        },
        handler: browserTabSwitch,
    },
    {
        name: "browser_tab_close",
        description: "Close a browser tab.",
        inputSchema: {
            type: "object",
            properties: {
                index: { type: "number", description: "Tab index to close (omit for current tab)" },
                ...SESSION_PROPS,
            },
        },
        handler: browserTabClose,
    },
    {
        name: "browser_window_new",
        description: "Open a new browser window.",
        inputSchema: { type: "object", properties: { ...SESSION_PROPS } },
        handler: browserWindowNew,
    },
    {
        name: "browser_frame",
        description: "Switch context to an iframe, or back to the main frame.",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "iframe CSS selector, or 'main' to return to main frame" },
                ...SESSION_PROPS,
            },
        },
        handler: browserFrame,
    },
    {
        name: "browser_dialog_accept",
        description: "Accept (OK) a browser dialog (alert, confirm, prompt).",
        inputSchema: {
            type: "object",
            properties: {
                text: { type: "string", description: "Text to enter for prompt dialogs" },
                ...SESSION_PROPS,
            },
        },
        handler: browserDialogAccept,
    },
    {
        name: "browser_dialog_dismiss",
        description: "Dismiss (Cancel) a browser dialog.",
        inputSchema: { type: "object", properties: { ...SESSION_PROPS } },
        handler: browserDialogDismiss,
    },
    {
        name: "browser_diff_snapshot",
        description: "Compare the current accessibility tree snapshot against a previous one to detect page changes.",
        inputSchema: {
            type: "object",
            properties: {
                baseline: { type: "string", description: "Path to baseline snapshot file (omit to compare with last snapshot)" },
                selector: { type: "string", description: "Scope diff to a CSS selector" },
                compact: { type: "boolean", description: "Compact diff output" },
                ...SESSION_PROPS,
            },
        },
        handler: browserDiffSnapshot,
    },
    {
        name: "browser_diff_screenshot",
        description: "Visual pixel diff between current screenshot and a baseline image.",
        inputSchema: {
            type: "object",
            properties: {
                baseline: { type: "string", description: "Path to baseline screenshot" },
                output: { type: "string", description: "Save diff image to this path" },
                threshold: { type: "number", description: "Color threshold 0-1 (default: varies)" },
                ...SESSION_PROPS,
            },
            required: ["baseline"],
        },
        handler: browserDiffScreenshot,
    },
    {
        name: "browser_diff_url",
        description: "Compare two URLs side-by-side via snapshot diff (and optionally screenshot diff).",
        inputSchema: {
            type: "object",
            properties: {
                url1: { type: "string", description: "First URL" },
                url2: { type: "string", description: "Second URL" },
                screenshot: { type: "boolean", description: "Also do a visual screenshot diff" },
                selector: { type: "string", description: "Scope diff to a CSS selector" },
                wait_until: { type: "string", description: "Wait strategy: load | networkidle" },
                ...SESSION_PROPS,
            },
            required: ["url1", "url2"],
        },
        handler: browserDiffUrl,
    },
    {
        name: "browser_console",
        description: "Read browser console messages (console.log, warn, error, info).",
        inputSchema: {
            type: "object",
            properties: {
                clear: { type: "boolean", description: "Clear console messages after reading" },
                ...SESSION_PROPS,
            },
        },
        handler: browserConsole,
    },
    {
        name: "browser_page_errors",
        description: "Read uncaught JavaScript exceptions on the page.",
        inputSchema: {
            type: "object",
            properties: {
                clear: { type: "boolean", description: "Clear errors after reading" },
                ...SESSION_PROPS,
            },
        },
        handler: browserPageErrors,
    },
    {
        name: "browser_highlight",
        description: "Visually highlight an element on the page (useful for debugging in headed mode).",
        inputSchema: {
            type: "object",
            properties: {
                selector: { type: "string", description: "Element ref or selector to highlight" },
                ...SESSION_PROPS,
            },
            required: ["selector"],
        },
        handler: browserHighlight,
    },
    {
        name: "browser_trace_start",
        description: "Start recording a Playwright trace for debugging and replay.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Output path for trace file" },
                ...SESSION_PROPS,
            },
        },
        handler: browserTraceStart,
    },
    {
        name: "browser_trace_stop",
        description: "Stop and save the current Playwright trace.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Output path for trace file" },
                ...SESSION_PROPS,
            },
        },
        handler: browserTraceStop,
    },
    {
        name: "browser_state_save",
        description: "Save current browser auth state (cookies, localStorage) to a file for reuse.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "File path to save state to" },
                ...SESSION_PROPS,
            },
            required: ["path"],
        },
        handler: browserStateSave,
    },
    {
        name: "browser_state_load",
        description: "Load a previously saved browser auth state from a file.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "File path to load state from" },
                ...SESSION_PROPS,
            },
            required: ["path"],
        },
        handler: browserStateLoad,
    },
    {
        name: "browser_state_list",
        description: "List all saved browser auth state files.",
        inputSchema: { type: "object", properties: { ...SESSION_PROPS } },
        handler: browserStateList,
    },
    {
        name: "browser_state_clear",
        description: "Clear saved browser auth state(s).",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "State name to clear" },
                all: { type: "boolean", description: "Clear all saved states" },
                ...SESSION_PROPS,
            },
        },
        handler: browserStateClear,
    },
    {
        name: "browser_session_list",
        description: "List all active isolated browser sessions.",
        inputSchema: { type: "object", properties: {} },
        handler: browserSessionList,
    },
    {
        name: "browser_auth_login",
        description: "Login using saved credentials from the auth vault.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Saved credential name to use" },
                ...SESSION_PROPS,
            },
            required: ["name"],
        },
        handler: browserAuthLogin,
    },
    {
        name: "browser_connect",
        description: "Connect to an existing Chrome browser via CDP (Chrome DevTools Protocol) port.",
        inputSchema: {
            type: "object",
            properties: {
                port: { type: "number", description: "CDP debug port (e.g. 9222)" },
                ...SESSION_PROPS,
            },
            required: ["port"],
        },
        handler: browserConnect,
    },
    {
        name: "browser_close",
        description: "Close the browser and end the session.",
        inputSchema: { type: "object", properties: { ...SESSION_PROPS } },
        handler: browserClose,
    },
];

export const BROWSER_TOOL_NAMES = BROWSER_TOOL_DEFINITIONS.map(t => t.name);
