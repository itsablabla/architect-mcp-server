<div align="center">
  <img src="./assets/logo.png" alt="Architect MCP Logo" width="250"/>

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

*(Pro-tip: For development, use `npm run dev` to enable auto-restarts.)*

### 2. Docker Setup (Recommended)

Don't want to mess with Node environments? Just spin it up with Docker Compose:

```bash
docker compose up -d
```

Your data and tools remain safe inside persistent Docker volumes, and the dashboard is instantly available at `http://localhost:3001`.

---

## 🧠 How the Workflow Looks

1. **Create:** Your AI agent needs to accomplish something new, so it writes the JavaScript code to do it.
2. **Review & Approve:** You review the tool's requested permissions and click "Approve", granting it secure network or file access. No rogue scripts allowed.
3. **Execute:** The agent runs its shiny new tool safely inside the isolated sandbox.
4. **Automate & Share:** The agent can set the tool to run on a schedule, chain it with other tools, or publish it to the global marketplace.

---

*Built with ❤️ and mass amounts of coffee by [Ageborn Dev](https://github.com/ageborn-dev).*  
*Because agents should be builders, not just users.*
