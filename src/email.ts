import type { Company, Update, Recipient } from "./db.js";
import { esc } from "./html.js";
import { periodLabel } from "./logic.js";

// Resend's shared test sender works without a verified domain, but then Resend only
// delivers to the email address that owns the Resend account. Verify a domain in Resend
// and set EMAIL_FROM_ADDRESS (optional, not a secret) to send to anyone.
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || "onboarding@resend.dev";

export async function sendEmail(msg: { fromName: string; to: string; subject: string; html: string }): Promise<{ ok: boolean; detail: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, detail: "RESEND_API_KEY not set; email skipped" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${msg.fromName.replace(/[<>"]/g, "")} <${FROM_ADDRESS}>`,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
      }),
    });
    const body = await r.text();
    if (!r.ok) return { ok: false, detail: `Resend ${r.status}: ${body.slice(0, 300)}` };
    return { ok: true, detail: body.slice(0, 200) };
  } catch (e: any) {
    return { ok: false, detail: `Resend request failed: ${e?.message || e}` };
  }
}

const wrap = (inner: string) => `<!doctype html><html><body style="margin:0;background:#f6f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1c">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<div style="background:#fff;border:1px solid #e6e5e0;border-radius:10px;padding:28px">${inner}</div>
<p style="font-size:12px;color:#888;text-align:center;margin-top:16px">Sent with Ledgerline</p>
</div></body></html>`;

export function publishEmailHtml(c: Company, u: Update, r: Recipient, link: string, historyLink: string) {
  const hl = (u.highlights || []).slice(0, 3).map((h) => `<li style="margin:4px 0">${esc(h)}</li>`).join("");
  return wrap(`
<p style="margin:0 0 6px;font-size:13px;color:#888">${esc(c.name)}</p>
<h1 style="margin:0 0 16px;font-size:20px">${esc(periodLabel(u.period))} investor update</h1>
<p style="margin:0 0 12px">Hi ${esc(r.name.split(" ")[0])},</p>
<p style="margin:0 0 12px">${esc(c.founder_name)} has shared the ${esc(periodLabel(u.period))} update for ${esc(c.name)}.</p>
${hl ? `<ul style="padding-left:18px;margin:0 0 18px">${hl}</ul>` : ""}
<p style="margin:0 0 18px"><a href="${esc(link)}" style="display:inline-block;background:#1c1c1c;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px">Read the update</a></p>
<p style="margin:0;font-size:13px;color:#666">All past updates: <a href="${esc(historyLink)}" style="color:#1c1c1c">${esc(historyLink)}</a></p>
<p style="margin:12px 0 0;font-size:12px;color:#999">This link is personal to you.</p>`);
}

export function reminderEmailHtml(c: Company, period: string, dashboard: string) {
  return wrap(`
<h1 style="margin:0 0 16px;font-size:20px">Time for your ${esc(periodLabel(period))} update</h1>
<p style="margin:0 0 12px">Hi ${esc(c.founder_name.split(" ")[0])}, there is no draft for ${esc(period)} yet.</p>
<p style="margin:0 0 12px">Open Claude and say something like: <em>"Draft my ${esc(periodLabel(period))} investor update for ${esc(c.name)}. MRR was …, burn …"</em>. Claude will pull your history from Ledgerline and save a draft.</p>
<p style="margin:0"><a href="${esc(dashboard)}" style="color:#1c1c1c">Open your dashboard</a></p>`);
}
