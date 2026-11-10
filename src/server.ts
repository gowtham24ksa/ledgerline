import express from "express";
import cookieSession from "cookie-session";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { migrate, one, q, type Company, type Update } from "./db.js";
import { seedOnBoot, resetDemoData } from "./seed.js";
import { verifyPassword, requireLogin } from "./auth.js";
import { buildMcpServer } from "./mcp.js";
import {
  baseUrl, links, companyBySecret, companyById, listUpdates, getUpdate, previousUpdate, listRecipients, addRecipient,
  removeRecipient, openStatus, openCounts, saveDraft, publish, recordView, cleanList,
  activeShareLink, createShareLink, shareLinkByToken,
} from "./services.js";
import { runChecks, nextPeriod, currentPeriod, INPUT_METRICS } from "./logic.js";
import * as P from "./pages.js";
import { sendEmail, reminderEmailHtml } from "./email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-secret-change-me";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.get("/health", (_req, res) => { res.json({ ok: true }); });

// ---------------- MCP (Streamable HTTP, stateless) ----------------
// The unguessable secret in the path identifies the company workspace, so Claude's
// custom connector can connect without OAuth.
app.post("/mcp/:secret", express.json({ limit: "1mb" }), async (req, res) => {
  const company = await companyBySecret(String(req.params.secret));
  if (!company) {
    res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unknown Ledgerline workspace" }, id: null });
    return;
  }
  const server = buildMcpServer(company);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP error", e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  }
});
const mcpNotAllowed: express.RequestHandler = (_req, res) => {
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server; use POST)" }, id: null });
};
app.get("/mcp/:secret", mcpNotAllowed);
app.delete("/mcp/:secret", mcpNotAllowed);
// No OAuth: answer discovery probes with a clean 404.
app.use("/.well-known", (_req, res) => { res.status(404).json({ error: "not_found" }); });

// ---------------- web app ----------------
app.use("/static", express.static(path.join(ROOT, "public"), { maxAge: "1h" }));
app.get("/static/marked.umd.js", (_req, res) => res.sendFile(path.join(ROOT, "node_modules/marked/lib/marked.umd.js")));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieSession({
  name: "ll_session",
  keys: [SESSION_SECRET],
  maxAge: 7 * 24 * 3600 * 1000,
  sameSite: "lax",
  httpOnly: true,
  secure: baseUrl().startsWith("https://"),
}));

type Sess = { companyId?: number; flash?: { kind: string; text: string } | null };
const sess = (req: express.Request) => (req.session || {}) as Sess;
const flash = (req: express.Request, kind: string, text: string) => { sess(req).flash = { kind, text }; };
const takeFlash = (req: express.Request) => { const f = sess(req).flash; sess(req).flash = null; return f; };
const me = async (req: express.Request) => (await companyById(sess(req).companyId!))!;
const wrap = (fn: (req: express.Request, res: express.Response) => Promise<any>): express.RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

app.get("/", (req, res) => res.redirect(sess(req).companyId ? "/dashboard" : "/login"));

app.get("/login", (req, res) => { res.send(P.loginPage(null, String(req.query.next || "/dashboard"))); });
app.post("/login", wrap(async (req, res) => {
  const { username, password } = req.body as Record<string, string>;
  const next = String(req.body.next || "/dashboard");
  const u = await one<{ company_id: number; password_hash: string }>("SELECT * FROM users WHERE username = $1", [String(username || "").trim().toLowerCase()]);
  if (!u || !verifyPassword(String(password || ""), u.password_hash)) {
    res.status(401).send(P.loginPage("Wrong email or password.", next));
    return;
  }
  sess(req).companyId = u.company_id;
  res.redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}));
app.post("/logout", (req, res) => { req.session = null; res.redirect("/login"); });

app.get("/dashboard", requireLogin, wrap(async (req, res) => {
  const c = await me(req);
  const updates = await listUpdates(c.id);
  const opens = await openCounts(c.id);
  const suggested = updates.length ? nextPeriod(updates[0].period) : currentPeriod();
  res.send(P.dashboardPage(c, updates, opens, suggested, takeFlash(req)));
}));

app.post("/updates/new", requireLogin, wrap(async (req, res) => {
  const c = await me(req);
  const period = String(req.body.period || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) { flash(req, "error", "Pick a valid month."); res.redirect("/dashboard"); return; }
  const existing = await getUpdate(c.id, period);
  if (existing) { res.redirect(`/updates/${existing.id}/edit`); return; }
  const r = await saveDraft(c, { period, metrics: {}, highlights: [], lowlights: [], asks: [], body_markdown: "" }, "app");
  res.redirect(`/updates/${r.update.id}/edit`);
}));

async function ownUpdate(req: express.Request): Promise<{ c: Company; u: Update } | null> {
  const c = await me(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return null;
  const u = await one<Update>("SELECT * FROM updates WHERE id = $1 AND company_id = $2", [id, c.id]);
  return u ? { c, u } : null;
}

app.get("/updates/:id/edit", requireLogin, wrap(async (req, res) => {
  const r = await ownUpdate(req);
  if (!r) { res.status(404).send(P.notFound()); return; }
  const prev = await previousUpdate(r.c.id, r.u.period);
  const checks = runChecks(r.u, prev || null);
  res.send(P.editorPage(r.c, r.u, prev || null, checks, await openStatus(r.u), takeFlash(req), baseUrl()));
}));

function formToDraft(body: any, period: string) {
  const metrics: any = {};
  for (const k of INPUT_METRICS) metrics[k] = body[`m_${k}`];
  const keys = [].concat(body.custom_key || []), vals = [].concat(body.custom_val || []);
  const custom: Record<string, string> = {};
  keys.forEach((k: string, i: number) => { if (String(k).trim()) custom[String(k).trim()] = vals[i] ?? ""; });
  metrics.custom = custom;
  const lines = (s: unknown) => cleanList(String(s || "").split(/\r?\n/).map((l) => l.replace(/^\s*[-*•]\s*/, "")));
  return {
    period, metrics,
    highlights: lines(body.highlights), lowlights: lines(body.lowlights), asks: lines(body.asks),
    body_markdown: String(body.body_markdown || ""),
  };
}

app.post("/updates/:id", requireLogin, wrap(async (req, res) => {
  const r = await ownUpdate(req);
  if (!r) { res.status(404).send(P.notFound()); return; }
  const saved = await saveDraft(r.c, formToDraft(req.body, r.u.period), "app", { allowPublished: true });
  if (req.body.action === "publish") {
    const pub = await publish(r.c, saved.update, req.body.send_email === "1");
    const failed = pub.emails.filter((e) => !e.ok);
    const sent = pub.emails.length - failed.length;
    flash(req, failed.length ? "error" : "ok",
      `Published.${req.body.send_email === "1" ? ` Emails sent: ${sent} of ${pub.emails.length}.` : " No emails sent."}` +
      (failed.length ? ` Failed: ${failed.map((f) => `${f.email} (${f.detail})`).join("; ")}` : ""));
  } else {
    flash(req, "ok", `Saved.${saved.checks.warnings.length ? ` ${saved.checks.warnings.length} warning(s) below.` : ""}`);
  }
  res.redirect(`/updates/${r.u.id}/edit`);
}));

app.post("/updates/:id/delete", requireLogin, wrap(async (req, res) => {
  const r = await ownUpdate(req);
  if (r && r.u.status === "draft") { await q("DELETE FROM updates WHERE id = $1", [r.u.id]); flash(req, "ok", `Deleted the ${r.u.period} draft.`); }
  res.redirect("/dashboard");
}));

app.get("/recipients", requireLogin, wrap(async (req, res) => {
  const c = await me(req);
  res.send(P.recipientsPage(c, await listRecipients(c.id), (await activeShareLink(c.id)) || null, takeFlash(req), baseUrl()));
}));
app.post("/recipients", requireLogin, wrap(async (req, res) => {
  const c = await me(req);
  const { name, email, firm } = req.body as Record<string, string>;
  if (!name?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || "")) { flash(req, "error", "Name and a valid email are required."); }
  else { await addRecipient(c.id, name, email, firm); flash(req, "ok", `Added ${name}.`); }
  res.redirect("/recipients");
}));
app.post("/recipients/:id/delete", requireLogin, wrap(async (req, res) => {
  const c = await me(req);
  await removeRecipient(c.id, { id: Number(req.params.id) });
  flash(req, "ok", "Investor removed.");
  res.redirect("/recipients");
}));

app.post("/share-link", requireLogin, wrap(async (req, res) => {
  const c = await me(req);
  await createShareLink(c.id);
  flash(req, "ok", "Share link created.");
  res.redirect("/recipients");
}));
app.post("/share-link/regenerate", requireLogin, wrap(async (req, res) => {
  const c = await me(req);
  await createShareLink(c.id, { revokeExisting: true });
  flash(req, "ok", "Old link revoked. A new share link is ready.");
  res.redirect("/recipients");
}));

app.get("/settings", requireLogin, wrap(async (req, res) => {
  const c = await me(req);
  res.send(P.settingsPage(c, links.mcp(c), takeFlash(req)));
}));
app.post("/settings", requireLogin, wrap(async (req, res) => {
  const c = await me(req);
  const email = String(req.body.founder_email || "").trim();
  await q("UPDATE companies SET founder_email = $2 WHERE id = $1", [c.id, email || null]);
  flash(req, "ok", "Saved.");
  res.redirect("/settings");
}));
app.post("/settings/reset-demo", requireLogin, wrap(async (req, res) => {
  const c = await me(req);
  await resetDemoData(c.id);
  flash(req, "ok", "Demo data reset: six seeded updates restored, views reset, everything else deleted.");
  res.redirect("/dashboard");
}));
app.post("/settings/reminder-test", requireLogin, wrap(async (req, res) => {
  const c = await me(req);
  const results = await runReminders({ force: true, companyId: c.id });
  flash(req, "info", results.join(" ") || "Nothing to do.");
  res.redirect("/settings");
}));

// ---------------- public pages (no login) ----------------
// A View is recorded only on /u/... with a valid investor token, and never when a founder is
// logged in or the URL has ?preview=1. History pages (/i, /s) never record views.
const isPreview = (req: express.Request) => req.query.preview === "1";

async function publishedPrev(companyId: number, period: string) {
  return (await one<Update>(
    "SELECT * FROM updates WHERE company_id = $1 AND period < $2 AND status = 'published' ORDER BY period DESC LIMIT 1",
    [companyId, period],
  )) || null;
}

app.get("/u/:slug/:period", wrap(async (req, res) => {
  const c = await one<Company>("SELECT * FROM companies WHERE slug = $1", [req.params.slug]);
  if (!c) { res.status(404).send(P.notFound()); return; }
  const u = await getUpdate(c.id, String(req.params.period));
  const isFounder = sess(req).companyId === c.id;
  if (!u || (u.status !== "published" && !isFounder)) { res.status(404).send(P.notFound("This update doesn't exist or isn't published yet.")); return; }
  const preview = isPreview(req);
  const token = typeof req.query.r === "string" ? req.query.r : null;
  let validToken: string | null = null;
  if (token) {
    const r = await one<{ id: number; token: string }>("SELECT id, token FROM recipients WHERE token = $1 AND company_id = $2", [token, c.id]);
    if (r) {
      validToken = r.token;
      if (u.status === "published" && !isFounder && !preview) await recordView(u.id, r.id);
    }
  }
  const published = await listUpdates(c.id, { publishedOnly: true });
  const pv = preview ? "&preview=1" : "";
  const banner = u.status === "draft"
    ? "Preview: this draft is not published yet. Investors can't see it."
    : preview || isFounder ? "Preview: this visit is not counted as an open." : undefined;
  res.set("Cache-Control", "no-store");
  res.send(P.publicUpdatePage(c, u, await publishedPrev(c.id, u.period), published, {
    updateHref: (p) => `/u/${c.slug}/${p}${validToken ? `?r=${encodeURIComponent(validToken)}${pv}` : preview ? "?preview=1" : ""}`,
    historyHref: validToken ? `/i/${encodeURIComponent(validToken)}${preview ? "?preview=1" : ""}` : undefined,
    banner,
  }));
}));

app.get("/i/:token", wrap(async (req, res) => {
  const r = await one<any>("SELECT * FROM recipients WHERE token = $1", [req.params.token]);
  if (!r) { res.status(404).send(P.notFound("This link isn't valid.")); return; }
  const c = (await companyById(r.company_id))!;
  const preview = isPreview(req) || sess(req).companyId === c.id;
  res.set("Cache-Control", "no-store");
  res.send(P.historyPage(c, await listUpdates(c.id, { publishedOnly: true }), {
    title: `${c.name} updates`,
    greeting: `Hi ${String(r.name).split(" ")[0]}, every update from`,
    updateHref: (p) => `/u/${c.slug}/${p}?r=${encodeURIComponent(r.token)}${isPreview(req) ? "&preview=1" : ""}`,
    banner: preview ? `Preview of ${r.name}'s page. Nothing you open from here counts as an open.` : undefined,
  }));
}));

// Company share link: read-only, untracked, revocable.
async function activeShare(req: express.Request, res: express.Response) {
  const s = await shareLinkByToken(String(req.params.token));
  if (!s) { res.status(404).send(P.notFound("This link isn't valid.")); return null; }
  if (s.revoked_at) { res.status(410).send(P.messagePage("Link inactive", "This link is no longer active.", "Link inactive")); return null; }
  return { s, c: (await companyById(s.company_id))! };
}
app.get("/s/:token", wrap(async (req, res) => {
  const a = await activeShare(req, res);
  if (!a) return;
  res.set("Cache-Control", "no-store");
  res.send(P.historyPage(a.c, await listUpdates(a.c.id, { publishedOnly: true }), {
    title: `${a.c.name} updates`,
    greeting: "Investor updates from",
    updateHref: (p) => `/s/${encodeURIComponent(a.s.token)}/${p}`,
  }));
}));
app.get("/s/:token/:period", wrap(async (req, res) => {
  const a = await activeShare(req, res);
  if (!a) return;
  const u = await getUpdate(a.c.id, String(req.params.period));
  if (!u || u.status !== "published") { res.status(404).send(P.notFound("This update doesn't exist or isn't published yet.")); return; }
  res.set("Cache-Control", "no-store");
  res.send(P.publicUpdatePage(a.c, u, await publishedPrev(a.c.id, u.period), await listUpdates(a.c.id, { publishedOnly: true }), {
    updateHref: (p) => `/s/${encodeURIComponent(a.s.token)}/${p}`,
    historyHref: `/s/${encodeURIComponent(a.s.token)}`,
  }));
}));

// ---------------- reminders ----------------
// On the 1st (UTC) email each founder if the month that just ended has no update yet.
async function runReminders(opts: { force?: boolean; companyId?: number } = {}) {
  const now = new Date();
  const out: string[] = [];
  if (!opts.force && now.getUTCDate() !== 1) return out;
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const period = currentPeriod(prevMonth);
  const cs = await q<Company>(opts.companyId ? "SELECT * FROM companies WHERE id = $1" : "SELECT * FROM companies", opts.companyId ? [opts.companyId] : []);
  for (const c of cs) {
    if (await getUpdate(c.id, period)) { out.push(`${c.name}: an update for ${period} already exists, no reminder needed.`); continue; }
    if (!c.founder_email) { out.push(`${c.name}: no founder email set.`); continue; }
    if (!opts.force && (await one("SELECT 1 FROM email_log WHERE company_id=$1 AND kind='reminder' AND ref=$2 AND ok", [c.id, period]))) continue;
    const r = await sendEmail({ fromName: "Ledgerline", to: c.founder_email, subject: `Reminder: your ${period} investor update`, html: reminderEmailHtml(c, period, links.dashboard()) });
    await q("INSERT INTO email_log (company_id, kind, ref, to_email, ok, detail) VALUES ($1,'reminder',$2,$3,$4,$5)", [c.id, period, c.founder_email, r.ok, r.detail]);
    out.push(`${c.name}: reminder for ${period} ${r.ok ? "sent" : "failed: " + r.detail}.`);
  }
  return out;
}
// External cron hook (optional): GET /cron/reminders?key=<hmac shown in logs at boot>
const CRON_KEY = crypto.createHmac("sha256", SESSION_SECRET).update("cron").digest("hex").slice(0, 24);
app.get("/cron/reminders", wrap(async (req, res) => {
  if (req.query.key !== CRON_KEY) { res.status(403).json({ error: "bad key" }); return; }
  res.json({ results: await runReminders() });
}));

app.use((_req, res) => { res.status(404).send(P.notFound()); });
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).send(P.notFound("Something went wrong. Please try again."));
});

const port = Number(process.env.PORT || 3000);
await migrate();
const seeded = await seedOnBoot();
if (seeded) console.log(`Demo data ${seeded} (Acme Payments).`);
const c = await one<Company>("SELECT * FROM companies ORDER BY id LIMIT 1");
app.listen(port, () => {
  console.log(`Ledgerline on ${baseUrl()} (port ${port})`);
  if (c) console.log(`MCP connector URL for ${c.name}: ${links.mcp(c)}`);
  console.log(`Cron URL: ${baseUrl()}/cron/reminders?key=${CRON_KEY}`);
});
// In-process daily reminder (instance is always-on); hourly tick, deduped via email_log.
setInterval(() => { runReminders().catch((e) => console.error("reminders", e)); }, 3600_000);
