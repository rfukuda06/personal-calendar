# Calendar MCP Server

Stdio MCP server that exposes every `cal.ts` command as a typed tool. Used by Claude Code in place of `npm run cal:prod` — one warm Node+Prisma process answers every tool call.

## Build & register

```bash
npm run mcp:build
claude mcp add-json --scope user calendar "$(cat <<'JSON'
{
  "command": "node",
  "args": ["/Users/renzofukuda/Desktop/Repos/personal_calendar/dist/mcp/server.mjs"],
  "env": {
    "DATABASE_URL": "<prod neon connection string>",
    "USER_ID": "<resolved user id — skip with DB lookup if unset>"
  }
}
JSON
)"
```

Then restart Claude Code. Tools appear as `mcp__calendar__list_events`, etc.

## Fallback

If the MCP breaks, the original `npm run cal:prod -- <command>` CLI still works — both go through `src/lib/calendar-ops.ts`.
