<div align="center">
  <img src="./assets/logo.png" alt="Architect MCP Logo" width="100"/>

# Architect MCP Server

  **The AI agent workshop that builds its own tools.**
</div>

---

## 🚀 What is Architect?

AI agents are incredibly smart, but they hit a wall when they need a tool that doesn't exist yet. **Architect MCP removes that wall.**

Instead of giving your AI agent a fixed, rigid toolbox, you give it an entire *workshop*. If your agent needs to call an unconventional API, parse an obscure file format, or hook into a database, it simply writes a custom tool for it on the fly.

Once approved by you, that tool runs securely in an isolated sandbox. The next time your agent hits the same problem? The customized tool is already there, ready to go.

---

## ✨ Key Features

- **Automated Tool Creation:** Agents construct, test, and permanently save their own JavaScript tools on the fly.
- **Ironclad Security & Sandboxing:** Every custom tool is executed in a highly restricted sandbox. Network or file system access requires explicit user approval through granular capability scopes.
- **Built-in Web Dashboard:** A beautiful, real-time dashboard UI (running on port `3001` out of the box). Manage your active tools, watch execution logs unfold in real time, monitor failures, and securely manage secrets.
- **Cron Scheduling:** Not just for manual use! Agents can set up custom tools to run on cron schedules or build continuous background pipelines.
- **Global Marketplace:** Why build from scratch if someone else already did? Agents can search (`marketplace_browse`), install (`marketplace_install`), and even share your creations (`marketplace_publish`) using a GitHub token.
- **Persistent Data Layer:** Built-in, blazing-fast SQLite storage to manage tools, run logs, and execution states reliably.

---

## 🛠️ Getting Started

### 1. Simple Local Setup

You can get running in seconds if you have Node.js installed.

```bash
npm install
npm run build
npm start
```

Or once published to npm, run it with zero setup:

```bash
npx architect-mcp-server
```

MCP client config (Claude Desktop / Claude Code / Cursor):

```json
{
  "mcpServers": {
    "architect": {
      "command": "npx",
      "args": ["architect-mcp-server"]
    }
  }
}
```

*(Pro-tip: For development, use `npm run dev` to enable auto-restarts.)*

### 2. Docker Setup (Recommended)

Don't want to mess with Node environments? Just spin it up with Docker Compose:

```bash
docker compose up -d
```

Your data and tools remain safe inside persistent Docker volumes, and the dashboard is instantly available at `http://localhost:3001`.

---

## ⚙️ Gateway API (Token Optimization)

Every exposed MCP tool costs context tokens in the AI client's session. Architect exposes its entire management surface through just **8 gateway tools** (~2K tokens total instead of ~23K for 170+ individual tools):

| Gateway | Covers |
|---|---|
| `tool` | create, update, validate, approve, activate, test, version, templates, import/export |
| `find` | list, search, view source, dependency graph, intent matching |
| `run` | batches, aliases, pipelines |
| `automate` | cron schedules, webhooks |
| `store` | secrets, key-value memory, MCP resources and prompts |
| `share` | marketplace publish/browse/install, peers |
| `admin` | stats, audit logs, caches, anomalies, personas, system status |
| `browser` | all browser automation actions |

Each gateway is called as `{action: "<name>", args: {...}}`. Calling `{action: "help"}` lists available actions; `{action: "help", args: {action: "create_tool"}}` returns that action's full parameter schema. Custom tools created by agents are always registered as directly callable MCP tools.

The webhook server (port `3002`) starts on demand — when a webhook exists or is created.

**Security:** capability approvals are bound to a SHA-256 hash of the tool's code and imports. Any code change invalidates the approval and the tool must be re-approved — a tool can never silently inherit permissions for new code. Imported tools never carry their own permissions.

## 🧱 Sandbox Execution

Tool code runs in a **pool of reusable child processes**, not in the main server process:

- **Real isolation** — each tool executes in a separate OS process with its own memory, in a fresh `vm` context per execution (no state leaks between tools).
- **Hard timeouts** — a runaway tool (even an infinite loop) is killed at the process level, not just signalled.
- **Per-process memory cap** — enforced via `--max-old-space-size`.
- **Brokered capabilities** — `net`, `fs`, `child_process`, `env`, `secrets`, and `callTool` are never available inside the sandbox directly; the child sends a request to the parent, which enforces the approved capability scope and performs the operation. The sandbox only ever sees results it is allowed to see.
- **Warm pool** — processes are reused across calls (recycled after a set number of executions or after any timeout), so there is no per-call spawn cost.

Tunable via environment variables: `ARCHITECT_SANDBOX_POOL` (max processes, default 4), `ARCHITECT_SANDBOX_MAX_EXEC` (executions before recycle, default 50), `ARCHITECT_SANDBOX_MEMORY_MB` (heap cap per process, default 128).

## 🛡️ Trust & Reliability

- **Secret redaction** — tool outputs, logs, and error messages are scanned for stored secret values before being returned to the AI; matches are replaced with `[REDACTED:NAME]`, blocking prompt-injection exfiltration.
- **Test-gated activation** — if a tool has test cases, they must pass in the sandbox before the tool activates (`create_tool`, `save_tool`, and templates all enforce this). Pass tests as a JSON array: `[{name, input, expect?, expectError?}]`.
- **Signed exports** — `export_tool` signs the tool with a local ed25519 key; `import_tool` refuses any signed export whose content was tampered with, and labels unsigned imports as untrusted.
- **Atomic writes** — version snapshot and tool write happen in a single SQLite transaction; schema migrations run automatically on startup.
- **Quarantine** — tools that fail to load (corrupt data, stale approvals) are quarantined and listed in `get_system_status` instead of silently skipped.
- **Health & rotation** — `GET http://localhost:3001/health` for liveness; the audit log is automatically capped (default 10,000 rows, tune with `ARCHITECT_AUDIT_MAX_ROWS`).
- Encryption and signing keys live in `data/` (never committed or published).

---

## 🧠 How the Workflow Looks

1. **Create:** Your AI agent needs to accomplish something new, so it writes the JavaScript code to do it.
2. **Review & Approve:** You review the tool's requested permissions and click "Approve", granting it secure network or file access. No rogue scripts allowed.
3. **Execute:** The agent runs its shiny new tool safely inside the isolated sandbox.
4. **Automate & Share:** The agent can set the tool to run on a schedule, chain it with other tools, or publish it to the global marketplace.

---

*Built with ❤️ and mass amounts of coffee by [Ageborn Dev](https://github.com/ageborn-dev).*  
*Because agents should be builders, not just users.*
