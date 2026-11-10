# Ledgerline Updates

Founders write monthly investor updates **in Claude**. Ledgerline stores each update as structured data, hosts it as a live page, emails investors their personal link, tracks who opened it, charts metric trends, and gives each investor one page with every update. Investors never need Claude.

**There is no AI inside this app.** No AI SDKs, no AI API keys. All writing happens in the customer's own Claude plan, through MCP. Ledgerline only stores data and does plain arithmetic (runway = cash ÷ net burn, month-on-month %).

| | |
|---|---|
| Live app | `https://ledgerline-production-1348.up.railway.app` |
| Test login | `founder@acme.test` / `ledgerline-demo` |
| MCP connector URL | `https://ledgerline-production-1348.up.railway.app/mcp/<WORKSPACE_SECRET>`, shown in the app under **Connect Claude** |

## Connect it to Claude (2 minutes)

1. Log in to the app and open **Connect Claude**. Copy the MCP connector URL.
2. In Claude (claude.ai or the desktop app): **Settings → Connectors → Add custom connector**.
3. Name: `Ledgerline`. URL: paste the connector URL. Leave the OAuth fields empty. Click **Add**.
4. In a new chat, open the tools menu (the "+" / sliders icon) and make sure **Ledgerline** is on.
5. Try:
   > Use Ledgerline to draft my November 2026 investor update. MRR $524k, revenue $533k, cash $920k, net burn $65k, headcount 32, churned MRR $5.5k, expansion MRR $12k, customers 366. Highlights: marketplace deal in final QA, hired a VP Sales. Lowlight: one bank partner integration slipped to January. Ask: intros to fintech-focused Series A leads.

Claude calls `get_update_context`, writes the letter, calls `save_update_draft` and shows you the warnings plus a link to edit the draft in the app. Then say *"publish it and email investors"* and Claude calls `publish_update`.

### Why there's no OAuth
The URL path contains an unguessable workspace secret (`/mcp/{workspace_secret}`, 192 bits). It identifies the company workspace, so Claude's custom connector can connect without an OAuth flow. Treat the URL like a password. OAuth discovery endpoints (`/.well-known/*`) return 404 on purpose, which tells Claude to connect without auth.

## MCP tools

Streamable HTTP transport (official MCP TypeScript SDK), stateless, `POST /mcp/{secret}`.

| Tool | What it does |
|---|---|
| `get_update_context()` | Last 6 periods of metrics with derived KPIs, bands and a health summary, plus the full text of the latest published update, so Claude doesn't contradict history. |
| `save_update_draft(period, metrics, highlights[], lowlights[], asks[], body_markdown)` | Creates or overwrites the draft for that period (refuses if already published). Returns draft id, dashboard link and rule-based checks: month-on-month changes, computed runway, warnings (stated runway differs from cash/net_burn by >10%, metric moved >50% MoM, missing core metrics). |
| `manage_recipients(action: add\|remove\|list, name?, email?, firm?)` | Manage investors. `list` includes last-opened date. |
| `get_share_links()` | Each investor's personal history link (`/i/{token}`) and the company share link (`/s/{token}`, created if none is active). |
| `publish_update(period, send_email)` | Publishes, returns each investor's personal link and who has opened it ("opened by X of Y"); emails links if `send_email` is true. Safe to call again to check opens. |

Test without Claude: `npm run build && node scripts/mcp-smoke.mjs <connector URL>` (uses the official MCP client SDK; it writes and publishes a 2026-11 update, so run it against a local DB or re-seed afterwards). Or use MCP Inspector: `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP", paste the URL.

## KPI interpretation (plain arithmetic, fixed thresholds)

Inputs: `mrr`, `cash`, `net_burn`, `headcount` (plus optional `revenue`, `churned_mrr`, `expansion_mrr`, custom KPIs). Derived on read, never stored, for each period with a previous period:

| KPI | Formula | Bands |
|---|---|---|
| MoM growth | (mrr − prev_mrr) ÷ prev_mrr | |
| Net new MRR | mrr − prev_mrr | |
| Burn multiple | net_burn ÷ net_new_mrr (= annualised burn ÷ net new ARR); "n/a – no net new revenue" if ≤ 0 | <1 exceptional · 1–1.5 strong · 1.5–2 solid · 2–3 concerning · >3 red flag ([Benchmark: CRV](https://www.crv.com/content/burn-multiple)) |
| Runway | cash ÷ net_burn, plus the month cash runs out | <6 critical · 6–12 watch · 12–18 healthy · >18 strong (rule of thumb) |
| Monthly GRR | (prev_mrr − churned_mrr) ÷ prev_mrr | |
| Monthly NRR | (prev_mrr − churned_mrr + expansion_mrr) ÷ prev_mrr | >100% expanding · 90–100% stable · <90% leaking |
| ARR per employee | mrr × 12 ÷ headcount | |

A one-line health summary (e.g. *"Growing 9.6% MoM at a 1.67x burn multiple (solid); 14.1 months of runway (healthy); NRR 101.7% (expanding)."*) is shown on the dashboard, the public update page and investor history pages, and returned to Claude by `get_update_context` and `save_update_draft` so the letter uses the same numbers. Every metric has a one-sentence "How to read this" explanation (tooltip and footnote).

## Sharing and view tracking

- **Personal investor links** (`/i/{token}`, and `/u/{slug}/{period}?r={token}` for each update): opening an update records a View. Investors page has **Copy link** and **Preview** per investor.
- Views are **never** recorded when a founder is logged in or the URL has `?preview=1`. History pages never record views.
- **Company share link** (`/s/{token}`): read-only full history for anyone, opens not tracked, **Revoke and regenerate** on the Investors page. A revoked link shows "This link is no longer active".
- **Reset demo data** (Connect Claude page) restores the six seeded months and fixed open history, keeping investors, share link and connector URL.

`node scripts/verify.mjs <base URL> <connector URL> [--reset]` checks all of the above end to end.

## Screens

- `/dashboard`: updates by period, status, "opened by X of Y", trend charts for MRR, net burn and runway (inline SVG).
- `/updates/:id/edit`: edit metrics, custom metrics, highlights, lowlights, asks and the Markdown letter with live preview; save; publish (optionally emailing investors). Shows checks and per-investor open status.
- `/recipients`: add/remove investors, last-opened date, link to each investor's history page.
- `/settings` ("Connect Claude"): connector URL and steps, founder email for reminders.
- `/u/{company_slug}/{period}?r={token}`: public, mobile-friendly update page with previous-updates timeline and trends. Opening it with a valid token records a view.
- `/i/{token}`: investor history: every published update, newest first, with trends.

## Data model

Postgres tables: `companies` (+ `mcp_secret`, `founder_email`), `users`, `updates` (metrics JSONB `{mrr, revenue, cash, net_burn, headcount, custom{}}`, highlights/lowlights/asks JSONB arrays, `body_markdown`, `status`, `created_via`, `published_at`), `recipients` (unique random `token`), `views`, `email_log`. Runway and month-on-month changes are calculated on read, never stored. Schema is created on boot; the demo workspace is seeded automatically if the database is empty.

Seed: **Acme Payments** (founder Priya Raman, fictional), 6 published updates May–October 2026: MRR $300k → $478k (~10% MoM), burn multiple improving from 2.8x (concerning) to 1.67x (solid), runway ~14 months. 3 fictional investors with a fixed, realistic open history.

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

## Deploy (Railway)

1. railway.com → **New Project → Deploy from GitHub repo** → pick this repo. `railway.json` sets build (`npm run build`), start (`npm start`) and the `/health` check.
2. In the project: **+ Create → Database → PostgreSQL**.
3. App service → **Variables**: `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`, `SESSION_SECRET` = any long random string, `RESEND_API_KEY` = your key.
4. App service → **Settings → Networking → Generate Domain**. Links use `RAILWAY_PUBLIC_DOMAIN` automatically.

The service stays always on (don't enable "Serverless"/app sleeping).

## Deploy (Render, alternative)

`render.yaml` is a Blueprint: an always-on Starter web service plus a Postgres database. Environment variables: `DATABASE_URL` (wired automatically), `SESSION_SECRET` (generated automatically), `RESEND_API_KEY` (paste it in). `RENDER_EXTERNAL_URL` is provided by Render and used to build links.

## Stack

Node 22 + TypeScript, Express 5, server-rendered HTML (template strings), `pg`, `cookie-session`, `marked` (Markdown, raw HTML escaped), `@modelcontextprotocol/sdk`, `zod`. No front-end framework.
