// Verifies view tracking rules, company share links and KPI output over HTTP + MCP.
// Usage: node scripts/verify.mjs <base URL> <MCP connector URL> [--reset]
//   --reset  afterwards restores the seeded demo updates and views (removes the test view).
// Uses the demo login from the seed. Adds one view for the first investor and regenerates the share link.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [base, mcpUrl] = process.argv.slice(2);
const reset = process.argv.includes("--reset");
if (!base || !mcpUrl) { console.error("usage: node scripts/verify.mjs <base> <mcp url> [--reset]"); process.exit(1); }
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failures++; };

const client = new Client({ name: "verify", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
const call = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
const opensFor = async (email) => (await call("manage_recipients", { action: "list" })).recipients.find((r) => r.email === email).total_opens;

// --- KPIs from MCP
const ctx = await call("get_update_context");
const last = ctx.last_6_periods.at(-1);
check(ctx.last_6_periods.length === 6, `context has 6 periods (${ctx.last_6_periods.map((p) => p.period).join(" ")})`);
check(!!last.derived?.summary, `latest summary: ${last.derived?.summary}`);
console.log("      burn multiples:", ctx.last_6_periods.map((p) => `${p.period}=${p.derived.burn_multiple ?? p.derived.burn_multiple_note ?? "—"}${p.derived.bands.burn_multiple ? "(" + p.derived.bands.burn_multiple.label + ")" : ""}`).join(" "));

// --- share links tool
const links = await call("get_share_links");
check(/\/s\//.test(links.company_share_link.url), `get_share_links company link ${links.company_share_link.url}`);
check(links.investor_links.length > 0 && /\/i\//.test(links.investor_links[0].personal_link), `get_share_links returns ${links.investor_links.length} investor links`);

// --- view rules
const inv = links.investor_links[0];
const token = decodeURIComponent(inv.personal_link.split("/i/")[1]);
const slug = ctx.company.slug, period = last.period;
const upage = `${base}/u/${slug}/${period}?r=${encodeURIComponent(token)}`;

const login = await fetch(`${base}/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "username=founder%40acme.test&password=ledgerline-demo&next=%2Fdashboard" });
const cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
check(login.status === 302 && cookie.includes("ll_session"), "founder login works");

let before = await opensFor(inv.email);
await fetch(`${base}/i/${encodeURIComponent(token)}`);
check((await opensFor(inv.email)) === before, "investor history page (/i) records no view");
await fetch(`${base}/i/${encodeURIComponent(token)}?preview=1`);
await fetch(`${upage}&preview=1`);
check((await opensFor(inv.email)) === before, "?preview=1 records no view");
await fetch(upage, { headers: { cookie } });
check((await opensFor(inv.email)) === before, "logged-in founder opening the investor link records no view");
const r = await fetch(upage);
const html = await r.text();
check((await opensFor(inv.email)) === before + 1, `logged-out investor link records exactly one view (${before} → ${before + 1})`);
check(html.includes("class=\"health\""), "public update page shows the health summary");
check(html.includes("Burn multiple") && html.includes("crv.com"), "public update page shows burn multiple with CRV benchmark link");

// --- company share link revoke
const oldUrl = links.company_share_link.url;
check((await fetch(oldUrl)).status === 200, "company share link opens");
const regen = await fetch(`${base}/share-link/regenerate`, { method: "POST", redirect: "manual", headers: { cookie } });
check(regen.status === 302, "revoke and regenerate");
const gone = await fetch(oldUrl);
const goneHtml = await gone.text();
check(gone.status === 410 && goneHtml.includes("This link is no longer active"), "revoked link shows 'This link is no longer active'");
const newer = await call("get_share_links");
check(newer.company_share_link.url !== oldUrl && (await fetch(newer.company_share_link.url)).status === 200, "new share link works");
before = await opensFor(inv.email);
await fetch(`${newer.company_share_link.url}/${period}`);
check((await opensFor(inv.email)) === before, "share link pages record no views");

if (reset) {
  const rr = await fetch(`${base}/settings/reset-demo`, { method: "POST", redirect: "manual", headers: { cookie } });
  check(rr.status === 302, "demo data reset (test view removed)");
}
await client.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
