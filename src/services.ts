import crypto from "node:crypto";
import { q, one, type Company, type Update, type Recipient, type Metrics } from "./db.js";
import { runChecks, deriveKpis, INPUT_METRICS } from "./logic.js";
import { sendEmail, publishEmailHtml } from "./email.js";

export const newToken = (bytes = 18) => crypto.randomBytes(bytes).toString("base64url");

export function baseUrl(): string {
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "";
  return (process.env.PUBLIC_URL || railway || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");
}

export const links = {
  dashboard: () => `${baseUrl()}/dashboard`,
  editor: (u: Pick<Update, "id">) => `${baseUrl()}/updates/${u.id}/edit`,
  publicPage: (c: Company, period: string, token?: string) =>
    `${baseUrl()}/u/${c.slug}/${period}${token ? `?r=${encodeURIComponent(token)}` : ""}`,
  investor: (token: string) => `${baseUrl()}/i/${encodeURIComponent(token)}`,
  mcp: (c: Company) => `${baseUrl()}/mcp/${c.mcp_secret}`,
  share: (token: string) => `${baseUrl()}/s/${encodeURIComponent(token)}`,
};

export async function companyBySecret(secret: string) {
  return one<Company>("SELECT * FROM companies WHERE mcp_secret = $1", [secret]);
}
export async function companyById(id: number) {
  return one<Company>("SELECT * FROM companies WHERE id = $1", [id]);
}

export async function listUpdates(companyId: number, opts: { publishedOnly?: boolean } = {}) {
  return q<Update>(
    `SELECT * FROM updates WHERE company_id = $1 ${opts.publishedOnly ? "AND status = 'published'" : ""} ORDER BY period DESC`,
    [companyId],
  );
}

export async function getUpdate(companyId: number, period: string) {
  return one<Update>("SELECT * FROM updates WHERE company_id = $1 AND period = $2", [companyId, period]);
}

export async function previousUpdate(companyId: number, period: string) {
  return one<Update>(
    "SELECT * FROM updates WHERE company_id = $1 AND period < $2 ORDER BY period DESC LIMIT 1",
    [companyId, period],
  );
}

export async function listRecipients(companyId: number) {
  return q<Recipient & { last_viewed_at: Date | null; views: number }>(
    `SELECT r.*, MAX(v.viewed_at) AS last_viewed_at, COUNT(v.id)::int AS views
       FROM recipients r LEFT JOIN views v ON v.recipient_id = r.id
      WHERE r.company_id = $1 GROUP BY r.id ORDER BY r.created_at, r.id`,
    [companyId],
  );
}

export async function addRecipient(companyId: number, name: string, email: string, firm?: string | null) {
  const em = email.trim().toLowerCase();
  const existing = await one<Recipient>("SELECT * FROM recipients WHERE company_id = $1 AND email = $2", [companyId, em]);
  if (existing) {
    return (await one<Recipient>(
      "UPDATE recipients SET name = $2, firm = COALESCE($3, firm) WHERE id = $1 RETURNING *",
      [existing.id, name.trim(), firm?.trim() || null],
    ))!;
  }
  return (await one<Recipient>(
    "INSERT INTO recipients (company_id, name, email, firm, token) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [companyId, name.trim(), em, firm?.trim() || null, newToken()],
  ))!;
}

export async function removeRecipient(companyId: number, by: { id?: number; email?: string }) {
  if (by.id) return q<Recipient>("DELETE FROM recipients WHERE company_id = $1 AND id = $2 RETURNING *", [companyId, by.id]);
  return q<Recipient>("DELETE FROM recipients WHERE company_id = $1 AND email = $2 RETURNING *", [
    companyId, (by.email || "").trim().toLowerCase(),
  ]);
}

/** Who opened a given update, against the current recipient list. */
export async function openStatus(update: Update) {
  const rows = await q<{ id: number; name: string; email: string; firm: string | null; token: string; first_viewed_at: Date | null; views: number }>(
    `SELECT r.id, r.name, r.email, r.firm, r.token, MIN(v.viewed_at) AS first_viewed_at, COUNT(v.id)::int AS views
       FROM recipients r LEFT JOIN views v ON v.recipient_id = r.id AND v.update_id = $2
      WHERE r.company_id = $1 GROUP BY r.id ORDER BY r.created_at, r.id`,
    [update.company_id, update.id],
  );
  return { opened: rows.filter((r) => r.views > 0).length, total: rows.length, recipients: rows };
}

export async function openCounts(companyId: number) {
  const rows = await q<{ update_id: number; opened: number }>(
    `SELECT v.update_id, COUNT(DISTINCT v.recipient_id)::int AS opened
       FROM views v JOIN recipients r ON r.id = v.recipient_id
      WHERE r.company_id = $1 GROUP BY v.update_id`,
    [companyId],
  );
  const total = (await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM recipients WHERE company_id = $1", [companyId]))!.n;
  return { byUpdate: new Map(rows.map((r) => [r.update_id, r.opened])), total };
}

export type DraftInput = {
  period: string;
  metrics: Metrics;
  highlights: string[];
  lowlights: string[];
  asks: string[];
  body_markdown: string;
};

export function cleanList(xs: unknown): string[] {
  return (Array.isArray(xs) ? xs : []).map((s) => String(s).trim()).filter(Boolean);
}

export function cleanMetrics(m: any): Metrics {
  const out: Metrics = {};
  for (const k of INPUT_METRICS) {
    const v = m?.[k];
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
    if (Number.isFinite(n)) out[k] = n;
  }
  const custom: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(m?.custom || {})) {
    const key = String(k).trim();
    if (!key || v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
    custom[key] = typeof v === "number" || (String(v).trim() !== "" && Number.isFinite(n) && /^[-\d.,\s]+$/.test(String(v))) ? n : String(v);
  }
  if (Object.keys(custom).length) out.custom = custom;
  return out;
}

/** Create or update the draft for a period. Throws if that period is already published (when fromClaude). */
export async function saveDraft(company: Company, input: DraftInput, via: "claude" | "app", opts: { allowPublished?: boolean } = {}) {
  const existing = await getUpdate(company.id, input.period);
  if (existing && existing.status === "published" && !opts.allowPublished) {
    throw new Error(
      `The ${input.period} update is already published. Published updates can be edited by the founder in the app: ${links.editor(existing)}`,
    );
  }
  const vals = [
    JSON.stringify(cleanMetrics(input.metrics)),
    JSON.stringify(cleanList(input.highlights)),
    JSON.stringify(cleanList(input.lowlights)),
    JSON.stringify(cleanList(input.asks)),
    input.body_markdown || "",
  ];
  let u: Update;
  if (existing) {
    u = (await one<Update>(
      `UPDATE updates SET metrics=$2, highlights=$3, lowlights=$4, asks=$5, body_markdown=$6, updated_at=now()
        WHERE id=$1 RETURNING *`,
      [existing.id, ...vals],
    ))!;
  } else {
    u = (await one<Update>(
      `INSERT INTO updates (company_id, period, metrics, highlights, lowlights, asks, body_markdown, created_via)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [company.id, input.period, ...vals, via],
    ))!;
  }
  const prev = await previousUpdate(company.id, u.period);
  return { update: u, created: !existing, checks: runChecks(u, prev || null), kpis: deriveKpis(u.period, u.metrics, prev?.metrics) };
}

export async function getContext(company: Company) {
  // Fetch 7 so the oldest of the 6 returned periods still has a previous month for derived KPIs.
  const seven = await q<Update>(
    "SELECT * FROM updates WHERE company_id = $1 ORDER BY period DESC LIMIT 7",
    [company.id],
  );
  const recent = seven.slice(0, 6);
  const chronological = [...seven].reverse();
  const periods = chronological
    .map((u, i) => ({
      period: u.period,
      status: u.status,
      metrics: u.metrics,
      derived: deriveKpis(u.period, u.metrics, i > 0 ? chronological[i - 1].metrics : null),
    }))
    .slice(seven.length > 6 ? 1 : 0);
  const lastPublished = recent.find((u) => u.status === "published");
  const draft = recent.find((u) => u.status === "draft");
  const rc = await one<{ n: number }>("SELECT COUNT(*)::int AS n FROM recipients WHERE company_id = $1", [company.id]);
  return {
    company: { name: company.name, slug: company.slug, founder_name: company.founder_name },
    today: new Date().toISOString().slice(0, 10),
    recipients_count: rc!.n,
    last_6_periods: periods,
    last_published_update: lastPublished
      ? {
          period: lastPublished.period,
          published_at: lastPublished.published_at,
          highlights: lastPublished.highlights,
          lowlights: lastPublished.lowlights,
          asks: lastPublished.asks,
          body_markdown: lastPublished.body_markdown,
        }
      : null,
    open_draft: draft ? { period: draft.period, dashboard_link: links.editor(draft) } : null,
    latest_health_summary: periods.length ? periods[periods.length - 1].derived.summary : null,
    notes: [
      "Use the derived numbers, bands and health summary exactly as given; never recompute or contradict them.",
      "runway_months is always computed as cash / net_burn; never state a different figure.",
      "burn_multiple = net_burn / net_new_mrr (benchmark bands: CRV). Runway and NRR bands are rules of thumb.",
      "Money values are in USD; headcount is people. Periods are YYYY-MM.",
    ],
  };
}

export async function publish(company: Company, update: Update, sendEmails: boolean) {
  let u = update;
  if (u.status !== "published") {
    u = (await one<Update>(
      "UPDATE updates SET status='published', published_at=now(), updated_at=now() WHERE id=$1 RETURNING *",
      [u.id],
    ))!;
  }
  const recipients = await listRecipients(company.id);
  const emails: { email: string; ok: boolean; detail: string }[] = [];
  if (sendEmails) {
    for (const r of recipients) {
      const link = links.publicPage(company, u.period, r.token);
      const res = await sendEmail({
        fromName: `${company.name} via Ledgerline`,
        to: r.email,
        subject: `${company.name} investor update: ${u.period}`,
        html: publishEmailHtml(company, u, r, link, links.investor(r.token)),
      });
      emails.push({ email: r.email, ok: res.ok, detail: res.detail });
      await q("INSERT INTO email_log (company_id, kind, ref, to_email, ok, detail) VALUES ($1,'publish',$2,$3,$4,$5)", [
        company.id, u.period, r.email, res.ok, res.detail,
      ]);
    }
  }
  const status = await openStatus(u);
  return {
    update: u,
    emails,
    status,
    links: status.recipients.map((r) => ({
      name: r.name,
      email: r.email,
      link: links.publicPage(company, u.period, r.token),
      investor_history: links.investor(r.token),
      opened: r.views > 0,
      first_opened_at: r.first_viewed_at,
    })),
  };
}

export async function recordView(updateId: number, recipientId: number) {
  await q("INSERT INTO views (update_id, recipient_id) VALUES ($1, $2)", [updateId, recipientId]);
}

// ---------------- company share links (untracked, read-only) ----------------

export async function activeShareLink(companyId: number) {
  return one<{ id: number; token: string; created_at: Date }>(
    "SELECT * FROM share_links WHERE company_id = $1 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1",
    [companyId],
  );
}

export async function createShareLink(companyId: number, opts: { revokeExisting?: boolean } = {}) {
  if (opts.revokeExisting) await q("UPDATE share_links SET revoked_at = now() WHERE company_id = $1 AND revoked_at IS NULL", [companyId]);
  else {
    const cur = await activeShareLink(companyId);
    if (cur) return cur;
  }
  return (await one<{ id: number; token: string; created_at: Date }>(
    "INSERT INTO share_links (company_id, token) VALUES ($1, $2) RETURNING *",
    [companyId, newToken(18)],
  ))!;
}

export async function shareLinkByToken(token: string) {
  return one<{ id: number; company_id: number; token: string; revoked_at: Date | null }>(
    "SELECT * FROM share_links WHERE token = $1",
    [token],
  );
}
