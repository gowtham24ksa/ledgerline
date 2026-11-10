import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Company } from "./db.js";
import { PLACEHOLDERS } from "./logic.js";

const PLACEHOLDER_GUIDE =
  "In highlights, lowlights, asks and body_markdown, write this month's numbers as live placeholders instead of typing them, " +
  "so the text stays correct if the founder edits a metric later. Available: " +
  PLACEHOLDERS.map((p) => `{{${p.token}}}`).join(", ") +
  ". Example: \"MRR grew {{mom_growth}} to {{mrr}} at a {{burn_multiple}} burn multiple ({{burn_band}}); {{runway}} of runway.\" " +
  "Type numbers literally only for things that are not metrics (e.g. a deal size or a past month's figure).";
import {
  getContext, saveDraft, listRecipients, addRecipient, removeRecipient, getUpdate, publish, links,
  activeShareLink, createShareLink,
} from "./services.js";

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  structuredContent: data as Record<string, unknown>,
});
const fail = (message: string) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
  isError: true,
});

const period = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must be YYYY-MM, e.g. 2026-11")
  .describe("Reporting month in YYYY-MM format, e.g. 2026-11 for November 2026.");

const money = (what: string) => z.number().finite().nullable().optional().describe(what);

const metricsSchema = z
  .object({
    mrr: money("Monthly recurring revenue at month end, in USD (number, no symbols)."),
    revenue: money("Total revenue recognised in the month, in USD."),
    cash: money("Cash in the bank at month end, in USD."),
    net_burn: money("Net cash burned in the month (cash out minus cash in), in USD. Positive means burning."),
    headcount: z.number().int().nonnegative().nullable().optional().describe("Full-time people at month end."),
    churned_mrr: money("Optional. MRR lost this month from cancellations and downgrades, in USD (positive number)."),
    expansion_mrr: money("Optional. MRR gained this month from existing customers upgrading, in USD."),
    custom: z
      .record(z.string().min(1).max(60), z.union([z.number().finite(), z.string().max(200)]))
      .optional()
      .describe('Optional extra KPIs as key/value pairs, e.g. {"customers": 412, "NRR %": 118}.'),
  })
  .strict();

const lines = (what: string) => z.array(z.string().min(1).max(500)).max(20).describe(what);

/** A fresh MCP server bound to one company workspace (the secret in the URL picks the company). */
export function buildMcpServer(company: Company) {
  const server = new McpServer(
    { name: "ledgerline", version: "1.0.0" },
    {
      instructions:
        `Ledgerline stores ${company.name}'s monthly investor updates. Typical flow: call get_update_context first, ` +
        "write the update with the founder, call save_update_draft, show the founder the warnings and dashboard link, " +
        "and only call publish_update when the founder explicitly asks to publish/send. Never invent metrics. " +
        PLACEHOLDER_GUIDE,
    },
  );

  server.registerTool(
    "get_update_context",
    {
      title: "Get update context",
      description:
        "Returns the last 6 periods of metrics with derived KPIs (MoM growth, net new MRR, burn multiple, runway, GRR/NRR, " +
        "ARR per employee), their bands and a one-line health summary, plus the full text of the " +
        "most recent published update. Call this BEFORE drafting so the new update describes what changed and does not " +
        "contradict history. Takes no arguments.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ok(await getContext(company)),
  );

  server.registerTool(
    "save_update_draft",
    {
      title: "Save update draft",
      description:
        "Creates the draft investor update for a period, or overwrites the existing draft for that period. Fails if that " +
        "period is already published. Returns the draft id, a dashboard link where the founder can edit it, and rule-based " +
        "checks: month-on-month changes, computed runway (cash / net_burn) and warnings (e.g. runway stated in the text " +
        "differs from cash/net_burn by >10%, or a metric moved >50% month on month). Also returns derived KPIs (MoM growth, " +
        "net new MRR, burn multiple, runway and runway end month, GRR/NRR, ARR per employee), their bands and a one-line " +
        "health summary. Show the warnings to the founder. " + PLACEHOLDER_GUIDE,
      inputSchema: {
        period,
        metrics: metricsSchema.describe("Key numbers for the month. Use plain numbers, e.g. 135000 not '$135k'."),
        highlights: lines("Short bullet points of wins this month, one sentence each."),
        lowlights: lines("Short bullet points of what went badly or is at risk."),
        asks: lines("Specific asks for investors (intros, hires, advice)."),
        body_markdown: z.string().max(20000).describe("The full update letter in Markdown (no HTML). Use {{placeholders}} for this month's numbers."),
      },
    },
    async (args) => {
      try {
        const r = await saveDraft(company, args, "claude");
        return ok({
          draft_id: r.update.id,
          period: r.update.period,
          status: r.update.status,
          created: r.created,
          dashboard_link: links.editor(r.update),
          preview_link: links.publicPage(company, r.update.period),
          checks: r.checks,
          derived: r.kpis,
          health_summary: r.kpis.summary,
          note: "Placeholders like {{mrr}} are filled in from the metrics wherever the update is shown.",
        });
      } catch (e: any) {
        return fail(e.message);
      }
    },
  );

  server.registerTool(
    "manage_recipients",
    {
      title: "Manage investor recipients",
      description:
        "Add, remove or list the investors who receive updates. 'add' needs name and email (firm optional); adding an existing " +
        "email updates the name/firm. 'remove' needs email. 'list' returns everyone with their last-opened date.",
      inputSchema: {
        action: z.enum(["add", "remove", "list"]).describe("What to do."),
        name: z.string().min(1).max(120).optional().describe("Investor's full name (required for add)."),
        email: z.string().email().max(200).optional().describe("Investor's email (required for add and remove)."),
        firm: z.string().max(120).optional().describe("Investor's firm or fund (optional)."),
      },
    },
    async ({ action, name, email, firm }) => {
      if (action === "add") {
        if (!name || !email) return fail("'add' requires name and email.");
        const r = await addRecipient(company.id, name, email, firm);
        return ok({ added: { name: r.name, email: r.email, firm: r.firm, investor_history: links.investor(r.token) } });
      }
      if (action === "remove") {
        if (!email) return fail("'remove' requires email.");
        const del = await removeRecipient(company.id, { email });
        if (!del.length) return fail(`No recipient with email ${email}.`);
        return ok({ removed: del.map((r) => ({ name: r.name, email: r.email })) });
      }
      const rs = await listRecipients(company.id);
      return ok({
        count: rs.length,
        recipients: rs.map((r) => ({ name: r.name, email: r.email, firm: r.firm, last_opened_at: r.last_viewed_at, total_opens: r.views })),
      });
    },
  );

  server.registerTool(
    "publish_update",
    {
      title: "Publish update",
      description:
        "Publishes the update for a period (draft → published), generates a personal link for every recipient and, if " +
        "send_email is true, emails each recipient their link. Safe to call again on an already-published update to get " +
        "the links and who has opened it. Only call when the founder explicitly asks to publish or send.",
      inputSchema: {
        period,
        send_email: z.boolean().describe("true to email every recipient their personal link now; false to only publish."),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ period, send_email }) => {
      const u = await getUpdate(company.id, period);
      if (!u) return fail(`No update exists for ${period}. Save a draft first with save_update_draft.`);
      const r = await publish(company, u, send_email);
      return ok({
        period: r.update.period,
        status: r.update.status,
        published_at: r.update.published_at,
        public_page: links.publicPage(company, period),
        opened_by: `${r.status.opened} of ${r.status.total}`,
        recipient_links: r.links,
        emails: send_email ? r.emails : "not sent (send_email=false)",
        dashboard_link: links.dashboard(),
      });
    },
  );

  server.registerTool(
    "get_share_links",
    {
      title: "Get share links",
      description:
        "Returns each investor's personal link (their history page with every update; opening an update from it is tracked) " +
        "and the company share link (read-only full history for anyone, opens not tracked). Creates the company share link " +
        "if none is active yet. Takes no arguments.",
      inputSchema: {},
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async () => {
      const existing = await activeShareLink(company.id);
      const share = existing || (await createShareLink(company.id));
      const rs = await listRecipients(company.id);
      return ok({
        company_share_link: {
          url: links.share(share.token),
          created_now: !existing,
          note: "Anyone with this link can view. Opens aren't tracked. The founder can revoke it on the Investors page.",
        },
        investor_links: rs.map((r) => ({ name: r.name, email: r.email, firm: r.firm, personal_link: links.investor(r.token), last_opened_at: r.last_viewed_at })),
      });
    },
  );

  return server;
}
