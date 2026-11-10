# Ledgerline Updates

Founders write monthly investor updates **in Claude**. Ledgerline stores each update as structured data, hosts it as a live page, emails investors their personal link, tracks who opened it, charts metric trends, and gives each investor one page with every update. Investors never need Claude.

**There is no AI inside this app.** No AI SDKs, no AI API keys. All writing happens in the customer's own Claude plan, through MCP. Ledgerline only stores data and does plain arithmetic (runway = cash ÷ net burn, month-on-month %).

| | |
|---|---|
| Live app | `https://<YOUR-SERVICE>.onrender.com` |
| Test login | `founder@acme.test` / `ledgerline-demo` |
| MCP connector URL | `https://<YOUR-SERVICE>.onrender.com/mcp/<WORKSPACE_SECRET>`, shown in the app under **Connect Claude** |

## Connect it to Claude (2 minutes)

1. Log in to the app and open **Connect Claude**. Copy the MCP connector URL.
2. In Claude (claude.ai or the desktop app): **Settings → Connectors → Add custom connector**.
3. Name: `Ledgerline`. URL: paste the connector URL. Leave the OAuth fields empty. Click **Add**.
4. In a new chat, open the tools menu (the "+" / sliders icon) and make sure **Ledgerline** is on.
5. Try:
   > Use Ledgerline to draft my November 2026 investor update. MRR $136k, revenue $139.5k, cash $1.79M, net burn $106k, headcount 23, customers 341. Highlights: marketplace integration in final QA, MRR up 10%. Lowlight: VP Sales search still open. Ask: intros to VP Sales candidates.

Claude calls `get_update_context`, writes the letter, calls `save_update_draft` and shows you the warnings plus a link to edit the draft in the app. Then say *"publish it and email investors"* and Claude calls `publish_update`.

### Why there's no OAuth
The URL path contains an unguessable workspace secret (`/mcp/{workspace_secret}`, 192 bits). It identifies the company workspace, so Claude's custom connector can connect without an OAuth flow. Treat the URL like a password. OAuth discovery endpoints (`/.well-known/*`) return 404 on purpose, which tells Claude to connect without auth.

## MCP tools

Streamable HTTP transport (official MCP TypeScript SDK), stateless, `POST /mcp/{secret}`.

| Tool | What it does |
|---|---|
| `get_update_context()` | Last 6 periods of metrics with computed runway and month-on-month %, plus the full text of the latest published update, so Claude doesn't contradict history. |
| `save_update_draft(period, metrics, highlights[], lowlights[], asks[], body_markdown)` | Creates or overwrites the draft for that period (refuses if already published). Returns draft id, dashboard link and rule-based checks: month-on-month changes, computed runway, warnings (stated runway differs from cash/net_burn by >10%, metric moved >50% MoM, missing core metrics). |
| `manage_recipients(action: add\|remove\|list, name?, email?, firm?)` | Manage investors. `list` includes last-opened date. |
| `publish_update(period, send_email)` | Publishes, returns each investor's personal link and who has opened it ("opened by X of Y"); emails links if `send_email` is true. Safe to call again to check opens. |

Test without Claude: `npm run build && node scripts/mcp-smoke.mjs <connector URL>` (uses the official MCP client SDK; it writes and publishes a 2026-11 update, so run it against a local DB or re-seed afterwards). Or use MCP Inspector: `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP", paste the URL.

## Screens

- `/dashboard`: updates by period, status, "opened by X of Y", trend charts for MRR, net burn and runway (inline SVG).
- `/updates/:id/edit`: edit metrics, custom metrics, highlights, lowlights, asks and the Markdown letter with live preview; save; publish (optionally emailing investors). Shows checks and per-investor open status.
- `/recipients`: add/remove investors, last-opened date, link to each investor's history page.
- `/settings` ("Connect Claude"): connector URL and steps, founder email for reminders.
- `/u/{company_slug}/{period}?r={token}`: public, mobile-friendly update page with previous-updates timeline and trends. Opening it with a valid token records a view.
- `/i/{token}`: investor history: every published update, newest first, with trends.

## Data model

Postgres tables: `companies` (+ `mcp_secret`, `founder_email`), `users`, `updates` (metrics JSONB `{mrr, revenue, cash, net_burn, headcount, custom{}}`, highlights/lowlights/asks JSONB arrays, `body_markdown`, `status`, `created_via`, `published_at`), `recipients` (unique random `token`), `views`, `email_log`. Runway and month-on-month changes are calculated on read, never stored. Schema is created on boot; the demo workspace is seeded automatically if the database is empty.

Seed: **Acme Payments** (founder Priya Raman, fictional), 5 published updates June–October 2026, 3 fictional investors with realistic open history.

## Email

Resend REST API. On publish each investor gets a short email from **"{Company} via Ledgerline"** with their personal link. Public pages carry a "Sent with Ledgerline" footer.

Note on Resend's free tier: without a verified domain, Resend only delivers to the email address that owns the Resend account. For the demo, add yourself as an investor (with that address). To send to anyone, verify a domain in Resend and set the optional `EMAIL_FROM_ADDRESS` (e.g. `updates@yourdomain.com`). Failed sends are reported back to Claude and in the app; publishing still succeeds.

**Reminders:** an hourly in-process check (the instance is always-on) emails the founder on the 1st of each month (UTC) if there's no update yet for the month that just ended. Deduplicated via `email_log`. There's also `GET /cron/reminders?key=…` for an external cron (key printed in the server log at boot), and a "Run reminder check now" button on the Connect Claude page.

## Run locally

```bash
npm install
npm run dev:db        # terminal 1: local Postgres (PGlite) on port 5433
npm run dev           # terminal 2: builds and serves http://localhost:3000
```

`npm run seed` wipes and re-seeds the database (prints the new connector URL).

## Deploy (Render)

`render.yaml` is a Blueprint: an always-on Starter web service plus a Postgres database. Environment variables: `DATABASE_URL` (wired automatically), `SESSION_SECRET` (generated automatically), `RESEND_API_KEY` (paste it in). `RENDER_EXTERNAL_URL` is provided by Render and used to build links.

## Stack

Node 22 + TypeScript, Express 5, server-rendered HTML (template strings), `pg`, `cookie-session`, `marked` (Markdown, raw HTML escaped), `@modelcontextprotocol/sdk`, `zod`. No front-end framework.
