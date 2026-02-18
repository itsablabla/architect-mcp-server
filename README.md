# Architect MCP Server

An MCP server that lets AI agents build, manage, and share their own tools — on the fly. Instead of being limited to a fixed set of capabilities, your AI agent can write a new tool, test it, publish it to a shared marketplace, and reuse it forever.

## Why Does This Exist?

AI agents are powerful, but they hit walls when they need a tool that doesn't exist yet. Architect-MCP removes that wall. If the agent needs to call an API, process a file, or automate a task — it just creates a tool for it, right there, in the middle of the conversation. Next time it needs the same thing? The tool is already there, ready to go.

Think of it like this: instead of giving an agent a fixed toolbox, you give it a workshop where it can build any tool it needs.

## Getting Started

### Install and Build

```bash
npm install
npm run build
```

### Run the Server

```bash
npm start
```

For development with automatic restarts:

```bash
npm run dev
```

### Run with Docker

If you prefer containers, Architect-MCP is Docker-ready. The easiest way is with Docker Compose:

```bash
docker compose up -d
```

This builds the image, starts the server, and keeps your tools, data, and marketplace files safe in persistent volumes. The dashboard will be at `http://localhost:3001` and webhooks at port `3002`.

To rebuild after pulling updates:

```bash
docker compose up -d --build
```

Or if you want to do it manually without Compose:

```bash
docker build -t architect-mcp .
docker run -d \
  --name architect-mcp \
  -p 3001:3001 \
  -p 3002:3002 \
  -v $(pwd)/custom_tools:/app/custom_tools \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/marketplace:/app/marketplace \
  architect-mcp
```

### Connect to Your AI Client

Add Architect-MCP to your MCP client configuration (Claude Desktop, Cursor, or any MCP-compatible client). Point it to the server's start command and you're good to go.

## How It Works — The Basics

### Step 1: Create a Tool

The AI agent (or you) creates a tool by providing a name, what it does, what inputs it accepts, and the JavaScript code that runs:

```json
{
  "name": "fetch_weather",
  "description": "Get current weather for a city",
  "schema": "{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"]}",
  "code": "const response = await fetch(`https://api.weather.example/${params.city}`); return response.body;",
  "capabilities": ["net:api.weather.example"],
  "category": "api",
  "tags": ["weather", "api"]
}
```

### Step 2: Approve Permissions

If the tool needs access to the internet, file system, or anything sensitive, you approve those permissions:

```json
{ "name": "fetch_weather" }
```

### Step 3: Activate It

Use `save_tool` to make it live. That's it — the tool now works like any built-in tool.

## All Available Tools

### Tool Management

The bread and butter. These are the tools your agent uses to create and manage other tools.

| Tool | What It Does |
| :--- | :--- |
| `create_tool` | Build a new tool from scratch. Automatically checks the marketplace and suggests composing existing tools before writing new code |
| `update_tool` | Change an existing tool's code, schema, or settings |
| `delete_tool` | Remove a tool you no longer need |
| `save_tool` | Activate a tool so it can be called |
| `validate_tool` | Check if your code has syntax errors (without creating anything) |
| `list_tools` | See all your tools, with optional filters by category or tag |
| `get_tool_source` | Look at a tool's code and configuration |
| `reload_tools` | Re-register all approved tools (useful after manual edits) |
| `search_tools` | Search your tools by name, description, category, or tags using semantic matching |
| `mark_tool_deprecated` | Mark a tool as deprecated so agents know to stop using it |

### Permissions & Security

Every tool runs inside a sandbox. It can't do anything dangerous unless you explicitly allow it.

| Tool | What It Does |
|------|-------------|
| `approve_tool` | Grant a tool the permissions it needs |
| `revoke_permissions` | Take back a tool's permissions |
| `list_permissions` | See what each tool is allowed to do |

**Permission types you can grant:**

- **`net`** — Make HTTP requests. You can restrict to specific domains: `net:api.example.com`
- **`fs`** — Read or write files. Specify what and where: `fs:read:/data` or `fs:write:/output`
- **`child_process`** — Run shell commands. Optionally limit which ones: `child_process:git,npm`
- **`env`** — Read environment variables. Restrict to specific ones: `env:API_KEY,DATABASE_URL`

### Versioning

Every change to a tool is tracked. You can go back in time if something breaks.

| Tool | What It Does |
|------|-------------|
| `list_versions` | See the full history of changes to a tool |
| `rollback_tool` | Revert a tool to a previous version |
| `diff_versions` | Compare two versions side by side |

### Secrets Management

Store API keys and passwords securely — never hardcode them in your tool's code.

| Tool | What It Does |
|------|-------------|
| `set_secret` | Save a secret (encrypted on your machine) |
| `get_secret` | Retrieve a secret |
| `delete_secret` | Remove a stored secret |
| `list_secrets` | See the names of all stored secrets (not the values) |

Inside your tool code, access secrets with `secrets.get("MY_API_KEY")` instead of typing the key directly. This way, when you share a tool on the marketplace, your keys stay private.

### Caching

Speed up tools that make expensive API calls by caching their results.

| Tool | What It Does |
|------|-------------|
| `cache_stats` | See how much is cached and hit/miss rates |
| `clear_cache` | Clear cached results for a specific tool or everything |

### Testing

Run your tool in a test environment before deploying it.

| Tool | What It Does |
|------|-------------|
| `run_tests` | Execute a tool's tests and see if they pass |

### Aliases

Create shortcuts for tools you use often, with pre-filled parameters.

| Tool | What It Does |
|------|-------------|
| `create_alias` | Create a shortcut (e.g., "weather" calls `fetch_weather` with `city: "London"`) |
| `execute_alias` | Run a shortcut |
| `delete_alias` | Remove a shortcut |
| `list_aliases` | See all your shortcuts |

### Batch Execution

Run the same tool with multiple inputs at once, in parallel.

| Tool | What It Does |
|------|-------------|
| `batch_execute` | Run a tool many times with different inputs, all at once |

### Pipelines

Chain tools together. The output of one tool feeds into the next.

| Tool | What It Does |
|------|-------------|
| `create_pipeline` | Define a sequence of tools to run in order |
| `execute_pipeline` | Run a pipeline |
| `delete_pipeline` | Remove a pipeline |
| `list_pipelines` | See all pipelines |

### Scheduling

Run tools automatically on a schedule (like cron jobs).

| Tool | What It Does |
|------|-------------|
| `create_schedule` | Schedule a tool to run at specific times (e.g., every 5 minutes) |
| `delete_schedule` | Remove a schedule |
| `list_schedules` | See all active schedules |

### Webhooks

Trigger tools from external services via HTTP.

| Tool | What It Does |
|------|-------------|
| `create_webhook` | Create a URL that triggers a tool when called |
| `delete_webhook` | Remove a webhook |
| `list_webhooks` | See all active webhooks |

### Resources & Prompts

Manage reusable content and prompt templates.

| Tool | What It Does |
|------|-------------|
| `create_resource` | Store reusable content (text, config, data) |
| `get_resource` | Read a specific resource |
| `delete_resource` | Remove a resource |
| `list_resources` | See all resources |
| `create_prompt` | Create a prompt template with variables |
| `render_prompt` | Fill in a template with actual values |
| `delete_prompt` | Remove a prompt |
| `list_prompts` | See all prompts |

### Templates

Don't start from zero — use pre-built templates for common tool types.

| Tool | What It Does |
|------|-------------|
| `list_templates` | Browse available starting points |
| `create_from_template` | Spin up a new tool based on a template |

Available templates include: API Fetcher, JSON API Client, File Reader, File Writer, Directory Lister, JSON Transformer, Text Processor, Shell Command Runner, Environment Variable Reader, Data Aggregator, Webhook Caller, and Timestamp Converter.

### Monitoring

Keep an eye on what's happening.

| Tool | What It Does |
|------|-------------|
| `get_tool_stats` | See how often a tool runs, how fast it is, and failure rates |
| `get_audit_logs` | Full history of every action taken |
| `get_tool_graph` | Visualize which tools depend on which other tools |

### Import & Export

Move tools between machines or back them up.

| Tool | What It Does |
|------|-------------|
| `export_tool` | Export a tool as JSON |
| `import_tool` | Import a tool from JSON |

### Agent Personas

Personas are saved toolset configurations. Instead of the agent having to figure out which tools to use every time, you define a named profile — a persona — that says "for this kind of work, use these tools and follow these instructions." The agent can activate a persona at the start of a session and immediately know its scope.

| Tool | What It Does |
|------|-------------|
| `create_persona` | Define a named persona with a tool list and optional system prompt |
| `list_personas` | See all saved personas |
| `activate_persona` | Load a persona — returns its tool list and instructions |
| `update_persona` | Change a persona's tools or instructions |
| `delete_persona` | Remove a persona |

A persona called `data_analyst` might include only file and data tools, with a system prompt that says to validate inputs before processing. A `devops` persona might include shell and scheduling tools. Once created, the agent activates the right one automatically based on the task at hand.

## The Marketplace

This is where sharing happens. The marketplace has two layers: **local** (on your machine) and **remote** (on GitHub, accessible to everyone).

### Local Marketplace

For organizing and backing up your tools on your own computer.

| Tool | What It Does |
|------|-------------|
| `marketplace_export` | Save a tool to your local marketplace folder |
| `marketplace_import` | Load a tool from your local marketplace |
| `marketplace_list` | See what's in your local marketplace |
| `marketplace_delete` | Remove a tool from your local marketplace |

### Remote Marketplace (GitHub)

Share your tools with the world. The remote marketplace lives on GitHub at [ageborn-dev/architect-mcp-marketplace](https://github.com/ageborn-dev/architect-mcp-marketplace). Anyone can browse and install tools. Publishing and deleting requires a free GitHub token.

| Tool | What It Does |
|------|-------------|
| `marketplace_publish` | Upload a tool to the shared marketplace |
| `marketplace_browse` | Search and explore available tools |
| `marketplace_install_remote` | Download and install a tool from the marketplace. Automatically increments the tool's install count |
| `marketplace_delete_remote` | Remove your tool from the marketplace |
| `report_tool_issue` | Report a failure or problem with a marketplace tool. Updates its failure count and success rate |
| `publish_tool_stats` | Push your local execution stats for a tool back to its marketplace entry so others can see real-world usage data |

Every tool on the remote marketplace now tracks how many times it has been installed, how many failure reports it has received, and a calculated success rate. When you browse the marketplace, you can see this reputation data alongside the tool description so you know what you're installing before you install it.

### Setting Up Your GitHub Token

To publish, browse, or install tools from the remote marketplace, you need a GitHub Personal Access Token. It's free and takes about 2 minutes:

1. Go to [github.com](https://github.com) → click your profile picture → **Settings**
2. Scroll down the left sidebar → **Developer settings**
3. Click **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**
4. Name it something like `architect-mcp`
5. Check the **`repo`** checkbox (this is the only permission needed)
6. Click **Generate token**
7. Copy the token (starts with `ghp_`) — you only see it once!
8. Store it in Architect-MCP:

```
set_secret name="GITHUB_TOKEN" value="ghp_your_token_here"
```

That's it. You're ready to use the marketplace.

### Ownership & Security

Your tools are tied to your GitHub identity. When you publish a tool, Architect-MCP looks up who you are using your token and stamps your GitHub user ID on the tool. This means:

- Only you can update a tool you published — nobody else can overwrite your work
- Only you can delete your tools — other users get a clear "this isn't yours" message
- Anyone can install your tools — sharing is open, ownership is protected
- Your token never leaves your machine — it's stored encrypted locally and only sent over HTTPS to GitHub's API
- No sensitive data is exposed — only your public GitHub username and user ID (already visible on your profile) are stored with the tool

The tool descriptions also remind AI agents to use `secrets.get()` for API keys instead of hardcoding them, so credentials never accidentally end up in shared tool code.

## Tool Dependencies

Tools can call other tools. This lets you build complex workflows from simple pieces:

```javascript
const userData = await callTool("fetch_user", { id: params.userId });
const orders = await callTool("fetch_orders", { userId: userData.id });
return { user: userData, orders };
```

Use `get_tool_graph` to visualize these relationships and understand what breaks if you change something.

## Rate Limiting

Prevent runaway tools from burning through API quotas:

```json
{
  "name": "expensive_api_call",
  "rate_limit_per_minute": 10,
  "rate_limit_per_hour": 100
}
```

## The Sandbox

Every tool runs in a secure sandbox with:

- **10 second timeout** (configurable)
- **Console output** (`console.log`, `console.error`, `console.warn`) captured and included in responses
- **Standard JavaScript** globals: `JSON`, `Math`, `Date`, `Array`, `Object`, `String`, `Number`, `Boolean`, `Promise`
- **`params`** object containing the input arguments
- **`secrets.get()`** for accessing stored credentials
- **Capability-gated APIs**: `fetch`, `fs`, `exec`, `env`, `callTool` — only available if approved

## Autonomous Operation

Architect is designed so the agent does the work, not the user. The server includes a set of built-in behaviors that guide the agent through the full tool lifecycle automatically.

When an agent starts a task, it is expected to search for existing tools before building anything new. If a matching persona exists for the task type, it activates it. When it builds new tools, it groups them into a persona automatically, writes tests, maps dependencies, and schedules recurring tasks without being asked. When a tool fails, the agent reads the error and the failing code together and attempts a fix immediately — it does not surface raw errors to the user. After a successful task, it publishes usage stats back to the marketplace if the tool is shared there.

The deprecation checker runs every six hours in the background. It tests every tool that has test cases and marks any tool that consistently fails with a `failingSince` timestamp. If a tool has been failing for more than three days, the agent is instructed to treat it as deprecated and find or build a replacement.

This is the direction the project is heading: a system where the agent manages its own toolset end to end, and the user only needs to describe what they want done.

## Web Dashboard

Architect-MCP comes with a built-in web dashboard for visual management. Once the server is running, open your browser to `http://localhost:3001` to see your tools, stats, and logs in a clean interface.

## Project Structure

```
architect-mcp/
  src/               # TypeScript source code
  dist/              # Compiled JavaScript (after build)
  custom_tools/      # Your saved tool definitions (JSON files)
  data/              # Versioning, scheduling, and state data
  marketplace/       # Local marketplace storage
  dashboard/         # Web dashboard files
  personas.json      # Saved agent personas
  permissions.json   # What each tool is allowed to do
  audit.log          # Full history of operations
```

## Quick Example

Here's a real-world scenario: your AI agent needs to look up GitHub user profiles. It creates a tool on the spot:

```json
{
  "name": "github_user",
  "description": "Get GitHub user profile information",
  "schema": "{\"type\":\"object\",\"properties\":{\"username\":{\"type\":\"string\",\"description\":\"GitHub username\"}},\"required\":[\"username\"]}",
  "code": "const response = await fetch(`https://api.github.com/users/${params.username}`, { headers: { 'User-Agent': 'architect-mcp' } }); if (!response.ok) throw new Error(`User not found: ${params.username}`); return response.body;",
  "capabilities": ["net:api.github.com"],
  "category": "api",
  "tags": ["github", "user", "profile"]
}
```

Then `approve_tool`, then `save_tool`. Done. The agent (or any future agent) can now call `github_user` whenever it needs to look up a profile. If it's useful enough, publish it to the marketplace for others to use too.

## What's Been Built So Far

This section tracks the major features that have shipped. It's meant to give a clear picture of where the project is and where it came from.

**Core tool lifecycle** — Create, update, delete, version, rollback, test, and approve tools. The foundation everything else sits on.

**Sandbox security** — Every tool runs isolated with explicit capability grants. Net access is scoped to specific domains, file access is scoped to specific paths, and shell access can be limited to specific commands.

**Marketplace** — Local and remote (GitHub-backed) tool sharing with ownership enforcement. Only the original publisher can modify or delete their tools.

**Tool reputation** — Every marketplace tool now tracks install counts, failure reports, and a calculated success rate. When you install a tool, the counter goes up automatically. When something breaks, you can report it. The success rate is visible when browsing.

**Semantic tool search** — `search_tools` lets the agent find existing tools by meaning, not just exact name. This is what prevents the agent from rebuilding things that already exist.

**Composition AI** — When creating a new tool, the server scores existing tools against the new tool's name and description. If there are strong matches, it suggests composing them instead of writing from scratch.

**Tool dependency graph** — `get_tool_graph` shows which tools call which other tools. Useful before modifying anything that other tools depend on.

**Deprecation checker** — A background job that runs every six hours, tests every tool that has test cases, and marks consistently failing tools with a `failingSince` timestamp. Tools that have been failing for more than three days are flagged for replacement.

**Self-healing** — When a tool execution fails, the error response includes the full tool code alongside the error message. The agent is instructed to read both and call `update_tool` with a fix immediately, rather than surfacing the raw error.

**Agent personas** — Named toolset configurations saved to disk. An agent can create a persona for a specific type of work, activate it at the start of a session, and immediately know which tools to use and how to behave. The agent creates and updates personas automatically as part of its normal workflow.

**Usage stats publishing** — After completing a task, the agent can push its local execution stats (total calls, success rate, average duration) back to the marketplace entry for that tool. This gives the community real-world performance data, not just the author's description.

**Autonomous lifecycle prompt** — The server's knowledge prompt now encodes the full agent decision tree: search before building, activate personas before starting, create personas and schedules after building, self-heal on failure, publish stats after success. This runs as standing instructions on every tool response.

---

*Built with love and mass amounts of coffee by [Ageborn Dev](https://github.com/ageborn-dev)*
