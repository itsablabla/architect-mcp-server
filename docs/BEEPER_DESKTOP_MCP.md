# Beeper Desktop API MCP

Standalone MCP server that fronts the **Beeper Desktop API**.

## What it does

Proxies:

- Official Desktop MCP at `$BEEPER_DESKTOP_URL/v0/mcp`
- REST helpers (`/health`, `/v1/accounts`, `/v1/chats`)

## Env

| Variable | Required | Default |
|---|---|---|
| `BEEPER_DESKTOP_TOKEN` | yes (`bdapi_…`) | — |
| `BEEPER_DESKTOP_URL` | no | `http://127.0.0.1:23373` |
| `BEEPER_DESKTOP_MCP_URL` | no | `$BEEPER_DESKTOP_URL/v0/mcp` |

Aliases accepted for the token: `BEEPER_ACCESS_TOKEN`, `BEEPER_TOKEN`.

## Run

```bash
npm run build
BEEPER_DESKTOP_TOKEN=bdapi_xxx \
BEEPER_DESKTOP_URL=http://127.0.0.1:23373 \
npm run beeper-desktop
```

MCP client config (local checkout):

```json
{
  "mcpServers": {
    "beeper-desktop": {
      "command": "node",
      "args": ["dist/beeper-desktop-mcp/index.js"],
      "env": {
        "BEEPER_DESKTOP_TOKEN": "bdapi_xxx",
        "BEEPER_DESKTOP_URL": "http://127.0.0.1:23373"
      }
    }
  }
}
```

## Tools

**Helpers**
- `beeper_health`
- `list_chats`
- `desktop_tools`
- `desktop_mcp_call`

**Official Desktop MCP (proxied)**
- `focus_app`
- `search`
- `get_accounts`
- `get_chat`
- `archive_chat`
- `search_chats`
- `set_chat_reminder`
- `clear_chat_reminder`
- `list_messages`
- `search_messages`
- `send_message` (`chatID=__dry_run__` supported)
- `search_docs`

## Notes

- Beeper Desktop (or Beeperbox) must be running with Desktop API enabled.
- If Desktop API is loopback-only, run this MCP server on the same host or expose the API behind auth.
