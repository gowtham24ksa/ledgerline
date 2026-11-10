// End-to-end smoke test of the MCP endpoint using the official MCP client SDK.
// Usage: node scripts/mcp-smoke.mjs <MCP connector URL>
// WARNING: writes a 2026-11 draft, publishes it (no email) and opens one investor link.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2];
if (!url) { console.error("usage: node scripts/mcp-smoke.mjs <mcp url>"); process.exit(1); }
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const data = JSON.parse(r.content[0].text);
  console.log(`\n=== ${name} ${r.isError ? "(ERROR)" : ""}`);
  return data;
};

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const ctx = await call("get_update_context");
console.log("periods:", ctx.last_6_periods.map((p) => `${p.period}:${p.metrics.mrr}`).join(" "), "| last:", ctx.last_published_update?.period);

const draft = await call("save_update_draft", {
  period: "2026-11",
  metrics: { mrr: 136000, revenue: 139500, cash: 1791000, net_burn: 106000, headcount: 23, custom: { customers: 341 } },
  highlights: ["MRR up 10% to $136k", "Marketplace integration in final QA"],
  lowlights: ["VP Sales search still open"],
  asks: ["Intros to VP Sales candidates"],
  body_markdown: "Hi all,\n\nNovember MRR reached **$136k**. We now have 20 months of runway.\n\n— Priya",
});
console.log("draft:", draft.draft_id, draft.dashboard_link);
console.log("runway:", draft.checks.computed_runway_months, "warnings:", draft.checks.warnings);

const bad = await call("save_update_draft", { period: "2026-10", metrics: {}, highlights: [], lowlights: [], asks: [], body_markdown: "x" });
console.log("overwrite published ->", bad.error?.slice(0, 60));

const rl = await call("manage_recipients", { action: "list" });
console.log("recipients:", rl.recipients.map((r) => r.email).join(", "));

const pub = await call("publish_update", { period: "2026-11", send_email: false });
console.log("published:", pub.status, "opened_by:", pub.opened_by);
const first = pub.recipient_links[0].link;
const res = await fetch(first);
console.log("opened investor link:", res.status);
const again = await call("publish_update", { period: "2026-11", send_email: false });
console.log("opened_by now:", again.opened_by);
await client.close();
