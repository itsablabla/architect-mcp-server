# Contributing to Architect MCP Server

First off — thanks for being here. This project is still early and every contribution matters a lot right now, whether it's a bug fix, a new feature, a tool template for the marketplace, or even just improving the docs.

---

## Before You Start

Please open an issue before working on anything significant. Not to gatekeep, but because I don't want you to spend hours on something that's already in progress, conflicts with the roadmap, or that I'd approach differently. A quick issue first saves everyone time.

For small stuff — typos, obvious bugs, minor improvements — just go ahead and open a PR directly.

---

## What Kind of Help Is Most Useful Right Now

- **Bug fixes** — if something breaks, I want to know about it and fix it fast
- **New tool templates** — the built-in templates are a good starting point but there's a lot of room to add more common patterns
- **Marketplace tools** — useful tools that others can install are the fastest way to make the project more valuable
- **Security improvements** — the sandbox is the most critical piece of this project; if you spot a gap, please report it responsibly (see Security section below)
- **Dashboard improvements** — the UI is functional but there's a lot of room to make it better
- **Documentation** — clear docs lower the barrier for new users significantly

---

## Getting the Project Running Locally

```bash
git clone https://github.com/ageborn-dev/architect-mcp-server.git
cd architect-mcp-server
npm install
npm run dev
```

The server will start and the dashboard will be at `http://localhost:3001`. The `npm run dev` command watches for changes and restarts automatically, so you don't need to rebuild manually while working.

If you prefer Docker:

```bash
docker compose up -d
```

---

## How to Submit a PR

1. Fork the repo
2. Create a branch with a descriptive name — something like `fix/webhook-timeout` or `feature/tool-dependency-graph`
3. Make your changes
4. Make sure the project still builds (`npm run build`) and nothing obviously breaks
5. Open a PR against `main` with a clear description of what you changed and why

Keep PRs focused. One thing per PR is ideal. Big PRs that touch everything at once are hard to review and slow to merge.

---

## Code Style

The project is TypeScript. A few things to keep consistent:

- Match the existing code style — if you're unsure, look at how similar things are done elsewhere in the codebase
- Keep functions small and focused
- If you're adding something new that's not immediately obvious, leave a comment explaining the intent — not the what, but the why
- No console.log left in production paths please

---

## Adding Tool Templates

If you want to add a new built-in template, it needs to cover a use case that's genuinely reusable across different setups. Adding a template that only works for one very specific API or workflow isn't the right fit here — that's what the marketplace is for.

Good templates are generic enough that someone can grab them and adapt them to their own use case in a few minutes.

---

## Security

If you find a security issue — especially anything related to the sandbox escaping, permission bypasses, or secrets leaking — please don't open a public issue. Email me directly instead. I'll take it seriously and respond quickly.

Public vulnerabilities in a project about running AI-generated code need to be handled carefully.

---

## Questions

If you're not sure about something, just open an issue and ask. I'd rather answer a question upfront than have someone spend time going in the wrong direction.

---

Thanks again for taking the time to contribute. This project is built on the idea that agents and tools should grow together — contributions are a pretty fitting way to make that happen.
