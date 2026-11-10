import type { Company, Update, Recipient } from "./db.js";
import {
  esc, layout, appNav, trendsPanel, updateBody, fmtDate, metricsTable,
} from "./html.js";
import { periodLabel, runway, fmtMetric, CORE_METRICS, METRIC_LABELS, type Checks } from "./logic.js";

const flashBox = (f?: { kind: string; text: string } | null) =>
  f ? `<div class="flash ${esc(f.kind)}">${esc(f.text)}</div>` : "";

export function loginPage(err: string | null, next: string) {
  return layout({
    title: "Log in · Ledgerline",
    body: `<div class="login card">
<h1 class="brand-lg">Ledgerline</h1>
<p class="muted">Investor updates, written in Claude.</p>
${err ? `<div class="flash error">${esc(err)}</div>` : ""}
<form method="post" action="/login">
<input type="hidden" name="next" value="${esc(next)}">
<label>Email<input name="username" type="email" autocomplete="username" required autofocus></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required></label>
<button class="btn primary wide">Log in</button>
</form></div>`,
  });
}

export function dashboardPage(c: Company, updates: Update[], opens: { byUpdate: Map<number, number>; total: number }, suggested: string, flash: any) {
  const rows = updates.map((u) => {
    const opened = opens.byUpdate.get(u.id) || 0;
    const rw = runway(u.metrics);
    return `<tr>
<td><a href="/updates/${u.id}/edit"><strong>${esc(periodLabel(u.period))}</strong></a><div class="muted small">${esc(u.period)}</div></td>
<td><span class="pill ${u.status}">${u.status}</span></td>
<td class="hide-sm">${esc(fmtMetric("mrr", u.metrics.mrr))}</td>
<td class="hide-sm">${esc(fmtMetric("net_burn", u.metrics.net_burn))}</td>
<td class="hide-sm">${rw === null ? "—" : rw + " mo"}</td>
<td>${u.status === "published" ? `opened by <strong>${opened} of ${opens.total}</strong>` : `<span class="muted">not sent</span>`}</td>
<td class="hide-sm"><span class="muted small">via ${esc(u.created_via)}</span></td>
<td class="actions"><a class="btn sm" href="/updates/${u.id}/edit">Edit</a>${u.status === "published" ? ` <a class="btn sm ghost" href="/u/${esc(c.slug)}/${esc(u.period)}" target="_blank">View</a>` : ""}</td>
</tr>`;
  }).join("");
  return layout({
    title: "Updates · Ledgerline",
    nav: appNav(c.name, "/dashboard"),
    body: `${flashBox(flash)}
<div class="page-head"><h1>Investor updates</h1>
<form method="post" action="/updates/new" class="row gap">
<input name="period" type="month" value="${esc(suggested)}" required aria-label="Period">
<button class="btn">New update</button></form></div>
<section class="card"><h2>Trends <span class="muted small">published updates</span></h2>
${trendsPanel(updates.filter((u) => u.status === "published"))}</section>
<section class="card flush"><table class="tbl">
<thead><tr><th>Period</th><th>Status</th><th class="hide-sm">MRR</th><th class="hide-sm">Net burn</th><th class="hide-sm">Runway</th><th>Opens</th><th class="hide-sm">Source</th><th></th></tr></thead>
<tbody>${rows || `<tr><td colspan="8" class="muted">No updates yet. Ask Claude to draft one.</td></tr>`}</tbody></table></section>
<p class="muted small">Tip: in Claude, say <em>"Draft my ${esc(periodLabel(suggested))} investor update"</em> with your numbers and notes. It appears here as a draft.</p>`,
  });
}

export function editorPage(c: Company, u: Update, checks: Checks, status: { opened: number; total: number; recipients: any[] }, flash: any, publicBase: string) {
  const m = u.metrics || {};
  const metricInput = (k: string) =>
    `<label class="mi">${esc(METRIC_LABELS[k])}<input name="m_${k}" inputmode="decimal" value="${esc((m as any)[k] ?? "")}" data-metric="${k}"></label>`;
  const customRows = Object.entries(m.custom || {}).map(([k, v]) => customRow(k, String(v))).join("") + customRow("", "");
  const warnings = checks.warnings.length
    ? `<ul class="warns">${checks.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`
    : `<p class="good small">No warnings.</p>`;
  const recips = status.recipients.map((r) => `<tr><td>${esc(r.name)}<div class="muted small">${esc(r.email)}</div></td>
<td>${r.views > 0 ? `<span class="pill published">opened</span> <span class="muted small">${fmtDate(r.first_viewed_at)}</span>` : `<span class="muted">not yet</span>`}</td>
<td><input class="copy" readonly value="${esc(publicBase)}/u/${esc(c.slug)}/${esc(u.period)}?r=${esc(r.token)}" onclick="this.select()"></td></tr>`).join("");
  return layout({
    title: `${periodLabel(u.period)} · Ledgerline`,
    nav: appNav(c.name, ""),
    head: `<script src="/static/marked.umd.js" defer></script><script src="/static/editor.js" defer></script>`,
    body: `${flashBox(flash)}
<div class="page-head"><div><a href="/dashboard" class="muted small">← All updates</a>
<h1>${esc(periodLabel(u.period))} <span class="pill ${u.status}">${u.status}</span></h1>
<p class="muted small">Created via ${esc(u.created_via)} · last saved ${fmtDate(u.updated_at)}${u.published_at ? ` · published ${fmtDate(u.published_at)}` : ""}</p></div>
<div class="row gap">${u.status === "published" ? `<a class="btn ghost" target="_blank" href="/u/${esc(c.slug)}/${esc(u.period)}">Public page ↗</a>` : `<a class="btn ghost" target="_blank" href="/u/${esc(c.slug)}/${esc(u.period)}">Preview ↗</a>`}</div></div>

<section class="card checks"><h2>Checks</h2>
<p class="small">Computed runway: <strong>${checks.computed_runway_months === null ? "—" : checks.computed_runway_months + " months"}</strong> (cash ÷ net burn)${checks.compared_to_period ? ` · compared with ${esc(checks.compared_to_period)}` : ""}</p>
${warnings}</section>

<div class="editor">
<form method="post" action="/updates/${u.id}" class="card" id="editor-form">
<h2>Metrics</h2>
<div class="metric-inputs">${CORE_METRICS.map(metricInput).join("")}</div>
<p class="muted small">Runway is calculated, not entered: <strong id="runway-live">${runway(m) ?? "—"}</strong> months.</p>
<h3>Custom metrics</h3>
<div id="custom-rows">${customRows}</div>
<button type="button" class="btn sm ghost" id="add-custom">+ Add metric</button>
<h2>Highlights <span class="muted small">one per line</span></h2>
<textarea name="highlights" rows="4">${esc((u.highlights || []).join("\n"))}</textarea>
<h2>Lowlights <span class="muted small">one per line</span></h2>
<textarea name="lowlights" rows="3">${esc((u.lowlights || []).join("\n"))}</textarea>
<h2>Asks <span class="muted small">one per line</span></h2>
<textarea name="asks" rows="3">${esc((u.asks || []).join("\n"))}</textarea>
<h2>Letter <span class="muted small">Markdown</span></h2>
<textarea name="body_markdown" rows="14" class="mono">${esc(u.body_markdown)}</textarea>
<div class="savebar">
<button class="btn primary" name="action" value="save">Save</button>
<label class="check"><input type="checkbox" name="send_email" value="1" ${u.status === "published" ? "" : "checked"}> email investors</label>
<button class="btn" name="action" value="publish" onclick="return confirm('${u.status === "published" ? "Save changes and re-send?" : "Publish this update?"}')">${u.status === "published" ? "Save &amp; re-publish" : "Save &amp; publish"}</button>
</div>
</form>
<section class="card preview"><h2>Live preview</h2>
<div class="pub-head"><div class="muted small">${esc(c.name)}</div><h1>${esc(periodLabel(u.period))} update</h1></div>
<div id="preview">${updateBody(u, null)}</div></section>
</div>

${u.status === "published" ? `<section class="card flush"><h2 class="pad">Opened by ${status.opened} of ${status.total}</h2>
<table class="tbl"><thead><tr><th>Investor</th><th>Status</th><th>Personal link</th></tr></thead><tbody>${recips}</tbody></table></section>` : ""}
${u.status === "draft" ? `<form method="post" action="/updates/${u.id}/delete" onsubmit="return confirm('Delete this draft?')"><button class="linkbtn danger">Delete draft</button></form>` : ""}`,
  });
}

function customRow(k: string, v: string) {
  return `<div class="custom-row"><input name="custom_key[]" placeholder="Name, e.g. Customers" value="${esc(k)}"><input name="custom_val[]" placeholder="Value" value="${esc(v)}"></div>`;
}

export function recipientsPage(c: Company, rs: (Recipient & { last_viewed_at: Date | null; views: number })[], flash: any, publicBase: string) {
  const rows = rs.map((r) => `<tr>
<td><strong>${esc(r.name)}</strong><div class="muted small">${esc(r.firm || "")}</div></td>
<td class="hide-sm">${esc(r.email)}</td>
<td>${r.last_viewed_at ? fmtDate(r.last_viewed_at) : `<span class="muted">never</span>`}<div class="muted small">${r.views} opens</div></td>
<td class="hide-sm"><a class="small" href="/i/${esc(r.token)}" target="_blank">History page ↗</a></td>
<td class="actions"><form method="post" action="/recipients/${r.id}/delete" onsubmit="return confirm('Remove ${esc(r.name)}?')"><button class="btn sm ghost">Remove</button></form></td>
</tr>`).join("");
  return layout({
    title: "Investors · Ledgerline",
    nav: appNav(c.name, "/recipients"),
    body: `${flashBox(flash)}<div class="page-head"><h1>Investors</h1></div>
<section class="card flush"><table class="tbl"><thead><tr><th>Investor</th><th class="hide-sm">Email</th><th>Last opened</th><th class="hide-sm"></th><th></th></tr></thead>
<tbody>${rows || `<tr><td colspan="5" class="muted">No investors yet.</td></tr>`}</tbody></table></section>
<section class="card"><h2>Add investor</h2>
<form method="post" action="/recipients" class="grid3">
<label>Name<input name="name" required></label>
<label>Email<input name="email" type="email" required></label>
<label>Firm <span class="muted small">optional</span><input name="firm"></label>
<button class="btn primary">Add investor</button></form></section>
<p class="muted small">Each investor gets an unguessable personal link. Opening it records a view. Their history page: ${esc(publicBase)}/i/&lt;token&gt;</p>`,
  });
}

export function settingsPage(c: Company, mcpUrl: string, flash: any) {
  return layout({
    title: "Connect Claude · Ledgerline",
    nav: appNav(c.name, "/settings"),
    body: `${flashBox(flash)}<div class="page-head"><h1>Connect Claude</h1></div>
<section class="card"><h2>Your MCP connector URL</h2>
<input class="copy big" readonly value="${esc(mcpUrl)}" onclick="this.select()">
<p class="muted small">The secret in this URL identifies the ${esc(c.name)} workspace, so no OAuth is needed. Treat it like a password.</p>
<ol class="steps">
<li>In Claude (claude.ai or the desktop app), open <strong>Settings → Connectors</strong>.</li>
<li>Click <strong>Add custom connector</strong>. Name it <em>Ledgerline</em> and paste the URL above. Leave OAuth fields empty. Click <strong>Add</strong>.</li>
<li>In a new chat, open the tools menu and make sure <strong>Ledgerline</strong> is enabled.</li>
<li>Try: <em>"Use Ledgerline to draft my November 2026 investor update. MRR $136k, revenue $139k, cash $1.79M, net burn $106k, headcount 23. Highlights: … "</em></li>
</ol></section>
<section class="card"><h2>Monthly reminder</h2>
<p class="small">On the 1st of each month, Ledgerline emails the founder if there's no update yet for the month that just ended.</p>
<form method="post" action="/settings" class="row gap wrap-sm">
<label class="grow">Founder email<input name="founder_email" type="email" value="${esc(c.founder_email || "")}" placeholder="you@company.com"></label>
<button class="btn">Save</button></form>
<form method="post" action="/settings/reminder-test" class="mt"><button class="btn ghost sm">Run reminder check now (ignores the date)</button></form>
</section>`,
  });
}

export function publicUpdatePage(c: Company, u: Update, prev: Update | null, published: Update[], token: string | null, preview: boolean) {
  const q = token ? `?r=${encodeURIComponent(token)}` : "";
  const timeline = published.map((p) => `<li class="${p.id === u.id ? "current" : ""}"><a href="/u/${esc(c.slug)}/${esc(p.period)}${q}">${esc(periodLabel(p.period))}</a>
<span class="muted small">${esc(fmtMetric("mrr", p.metrics.mrr))} MRR</span></li>`).join("");
  const upto = published.filter((p) => p.period <= u.period);
  return layout({
    title: `${c.name} · ${periodLabel(u.period)} update`,
    footer: true,
    body: `${preview ? `<div class="flash info">Preview: this ${u.status === "draft" ? "draft is not published yet. Investors can't see it." : "is how investors see it. Your visit is not counted as a view."}</div>` : ""}
<div class="pub">
<div class="pub-main">
<div class="pub-head"><div class="muted">${esc(c.name)}${token ? ` · <a href="/i/${esc(token)}">All updates</a>` : ""}</div>
<h1>${esc(periodLabel(u.period))} update</h1>
<p class="muted small">From ${esc(c.founder_name)}${u.published_at ? ` · ${fmtDate(u.published_at)}` : ""}</p></div>
${updateBody(u, prev)}
<section class="card"><h2>Trends</h2>${trendsPanel(upto.length ? upto : [u])}</section>
</div>
<aside class="pub-side"><h3>Previous updates</h3><ul class="timeline">${timeline || `<li class="muted">None yet</li>`}</ul></aside>
</div>`,
  });
}

export function investorPage(c: Company, r: Recipient, published: Update[]) {
  const cards = published.map((u, i) => {
    const prev = published[i + 1] || null;
    return `<article class="card hist"><div class="row between"><h2><a href="/u/${esc(c.slug)}/${esc(u.period)}?r=${esc(r.token)}">${esc(periodLabel(u.period))}</a></h2>
<span class="muted small">${fmtDate(u.published_at)}</span></div>
${metricsTable(u, prev)}
${u.highlights.length ? `<ul class="compact">${u.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
<a class="btn sm" href="/u/${esc(c.slug)}/${esc(u.period)}?r=${esc(r.token)}">Read full update →</a></article>`;
  }).join("");
  return layout({
    title: `${c.name} updates`,
    footer: true,
    body: `<div class="pub-head"><div class="muted">Hi ${esc(r.name.split(" ")[0])}, every update from</div><h1>${esc(c.name)}</h1>
<p class="muted small">${published.length} published update${published.length === 1 ? "" : "s"} · newest first</p></div>
<section class="card"><h2>Trends</h2>${trendsPanel(published)}</section>
${cards || `<p class="muted">No updates published yet.</p>`}`,
  });
}

export function notFound(msg = "Not found") {
  return layout({ title: "Not found", footer: true, body: `<div class="card center"><h1>404</h1><p class="muted">${esc(msg)}</p></div>` });
}
