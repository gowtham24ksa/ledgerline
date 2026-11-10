import type { Company, Update, Recipient } from "./db.js";
import {
  esc, layout, appNav, trendsPanel, updateBody, fmtDate, metricsTable, healthLine, kpiPanel, bandChip,
} from "./html.js";
import { periodLabel, runway, fmtMetric, CORE_METRICS, METRIC_LABELS, METRIC_HELP, deriveKpis, type Checks, type Kpis } from "./logic.js";

const flashBox = (f?: { kind: string; text: string } | null) =>
  f ? `<div class="flash ${esc(f.kind)}">${esc(f.text)}</div>` : "";

/** Pairs each update (newest first) with its derived KPIs, using the next-older update as "previous". */
export function withKpis(updatesNewestFirst: Update[]): { u: Update; k: Kpis; prev: Update | null }[] {
  return updatesNewestFirst.map((u, i) => {
    const prev = updatesNewestFirst[i + 1] || null;
    return { u, k: deriveKpis(u.period, u.metrics, prev?.metrics), prev };
  });
}

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
  // KPIs per update use the next-older update of any status as "previous".
  const all = withKpis(updates);
  const latestPub = all.find((x) => x.u.status === "published");
  const rows = all.map(({ u, k }) => {
    const opened = opens.byUpdate.get(u.id) || 0;
    return `<tr>
<td><a href="/updates/${u.id}/edit"><strong>${esc(periodLabel(u.period))}</strong></a><div class="muted small">${esc(u.period)}</div></td>
<td><span class="pill ${u.status}">${u.status}</span></td>
<td class="hide-sm">${esc(fmtMetric("mrr", u.metrics.mrr))}${k.mom_growth_pct !== null ? `<div class="muted small">${k.mom_growth_pct > 0 ? "+" : ""}${k.mom_growth_pct}% MoM</div>` : ""}</td>
<td class="hide-sm">${k.burn_multiple !== null ? `${k.burn_multiple}x ${bandChip(k.bands.burn_multiple)}` : `<span class="muted">—</span>`}</td>
<td class="hide-sm">${k.runway_months === null ? "—" : `${k.runway_months} mo ${bandChip(k.bands.runway)}`}</td>
<td>${u.status === "published" ? `opened by <strong>${opened} of ${opens.total}</strong>` : `<span class="muted">not sent</span>`}</td>
<td class="hide-sm"><span class="muted small">via ${esc(u.created_via)}</span></td>
<td class="actions"><a class="btn sm" href="/updates/${u.id}/edit">Edit</a>${u.status === "published" ? ` <a class="btn sm ghost" href="/u/${esc(c.slug)}/${esc(u.period)}" target="_blank">View</a>` : ""}</td>
</tr>`;
  }).join("");
  return layout({
    title: "Updates · Ledgerline",
    nav: appNav(c.name, "/dashboard"),
    head: `<script src="/static/app.js" defer></script>`,
    body: `${flashBox(flash)}
<div class="page-head"><h1>Investor updates</h1>
<form method="post" action="/updates/new" class="row gap">
<input name="period" type="month" value="${esc(suggested)}" required aria-label="Period">
<button class="btn">New update</button></form></div>
${latestPub ? healthLine(latestPub.k, `Latest (${periodLabel(latestPub.u.period)})`) : ""}
<section class="card"><h2>Trends <span class="muted small">published updates</span></h2>
${trendsPanel(updates.filter((u) => u.status === "published"))}</section>
<section class="card flush"><table class="tbl">
<thead><tr><th>Period</th><th>Status</th><th class="hide-sm">MRR</th><th class="hide-sm" title="${esc(METRIC_HELP.burn_multiple)}">Burn multiple</th><th class="hide-sm">Runway</th><th>Opens</th><th class="hide-sm">Source</th><th></th></tr></thead>
<tbody>${rows || `<tr><td colspan="8" class="muted">No updates yet. Ask Claude to draft one.</td></tr>`}</tbody></table></section>
<p class="muted small">Tip: in Claude, say <em>"Draft my ${esc(periodLabel(suggested))} investor update"</em> with your numbers and notes. It appears here as a draft.</p>`,
  });
}

export function editorPage(c: Company, u: Update, prev: Update | null, checks: Checks, status: { opened: number; total: number; recipients: any[] }, flash: any, publicBase: string) {
  const m = u.metrics || {};
  const k = deriveKpis(u.period, m, prev?.metrics);
  const metricInput = (key: string) =>
    `<label class="mi" title="${esc(METRIC_HELP[key] || "")}">${esc(METRIC_LABELS[key])}${key === "churned_mrr" || key === "expansion_mrr" || key === "revenue" ? ` <span class="muted">(optional)</span>` : ""}<input name="m_${key}" inputmode="decimal" value="${esc((m as any)[key] ?? "")}" data-metric="${key}"></label>`;
  const customRows = Object.entries(m.custom || {}).map(([ck, v]) => customRow(ck, String(v))).join("") + customRow("", "");
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
<div class="row gap"><a class="btn ghost" target="_blank" href="/u/${esc(c.slug)}/${esc(u.period)}">${u.status === "published" ? "Public page ↗" : "Preview ↗"}</a></div></div>

<section class="card checks"><h2>Checks</h2>
${healthLine(k)}
<p class="small">Computed runway: <strong>${checks.computed_runway_months === null ? "—" : checks.computed_runway_months + " months"}</strong> (cash ÷ net burn)${checks.compared_to_period ? ` · compared with ${esc(checks.compared_to_period)}` : ""}</p>
${warnings}
${kpiPanel(k)}</section>

<div class="editor">
<form method="post" action="/updates/${u.id}" class="card" id="editor-form">
<h2>Metrics</h2>
<div class="metric-inputs">${CORE_METRICS.map(metricInput).join("")}</div>
<p class="muted small">Runway is calculated, not entered: <strong id="runway-live">${runway(m) ?? "—"}</strong> months. Ratios (burn multiple, NRR…) update when you save.</p>
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
<button class="btn" name="action" value="publish" onclick="return confirm('${u.status === "published" ? "Save changes and re-publish?" : "Publish this update?"}')">${u.status === "published" ? "Save &amp; re-publish" : "Save &amp; publish"}</button>
</div>
</form>
<section class="card preview"><h2>Live preview</h2>
<div class="pub-head"><div class="muted small">${esc(c.name)}</div><h1>${esc(periodLabel(u.period))} update</h1></div>
<div id="preview">${updateBody(u, prev)}</div></section>
</div>

${u.status === "published" ? `<section class="card flush"><h2 class="pad">Opened by ${status.opened} of ${status.total}</h2>
<table class="tbl"><thead><tr><th>Investor</th><th>Status</th><th>Personal link</th></tr></thead><tbody>${recips}</tbody></table></section>` : ""}
${u.status === "draft" ? `<form method="post" action="/updates/${u.id}/delete" onsubmit="return confirm('Delete this draft?')"><button class="linkbtn danger">Delete draft</button></form>` : ""}`,
  });
}

function customRow(k: string, v: string) {
  return `<div class="custom-row"><input name="custom_key[]" placeholder="Name, e.g. Customers" value="${esc(k)}"><input name="custom_val[]" placeholder="Value" value="${esc(v)}"></div>`;
}

export function recipientsPage(
  c: Company,
  rs: (Recipient & { last_viewed_at: Date | null; views: number })[],
  share: { token: string; created_at: Date } | null,
  flash: any,
  publicBase: string,
) {
  const rows = rs.map((r) => {
    const link = `${publicBase}/i/${r.token}`;
    return `<tr>
<td><strong>${esc(r.name)}</strong><div class="muted small">${esc(r.firm || "")}</div></td>
<td class="hide-sm">${esc(r.email)}</td>
<td>${r.last_viewed_at ? fmtDate(r.last_viewed_at) : `<span class="muted">never</span>`}<div class="muted small">${r.views} opens</div></td>
<td class="actions"><button type="button" class="btn sm" data-copy="${esc(link)}">Copy link</button>
<a class="btn sm ghost" href="/i/${esc(r.token)}?preview=1" target="_blank">Preview</a>
<form method="post" action="/recipients/${r.id}/delete" class="inline" onsubmit="return confirm('Remove ${esc(r.name)}?')"><button class="btn sm ghost">Remove</button></form></td>
</tr>`;
  }).join("");
  const shareUrl = share ? `${publicBase}/s/${share.token}` : "";
  return layout({
    title: "Investors · Ledgerline",
    nav: appNav(c.name, "/recipients"),
    head: `<script src="/static/app.js" defer></script>`,
    body: `${flashBox(flash)}<div class="page-head"><h1>Investors</h1></div>
<section class="card"><h2>Company share link</h2>
${share ? `<div class="row gap wrap-sm"><input class="copy big grow" readonly value="${esc(shareUrl)}" onclick="this.select()"><button type="button" class="btn" data-copy="${esc(shareUrl)}">Copy</button></div>
<p class="muted small">Anyone with this link can view. Opens aren't tracked. Created ${fmtDate(share.created_at)}.</p>
<form method="post" action="/share-link/regenerate" onsubmit="return confirm('The current link will stop working. Continue?')"><button class="btn sm ghost">Revoke and regenerate</button></form>`
      : `<p class="small">A read-only link to your full update history for people who aren't on your investor list (prospective investors, advisors).</p>
<form method="post" action="/share-link"><button class="btn primary">Generate shareable link</button></form>
<p class="muted small">Anyone with this link can view. Opens aren't tracked.</p>`}
</section>
<section class="card flush"><table class="tbl"><thead><tr><th>Investor</th><th class="hide-sm">Email</th><th>Last opened</th><th></th></tr></thead>
<tbody>${rows || `<tr><td colspan="4" class="muted">No investors yet.</td></tr>`}</tbody></table></section>
<p class="muted small">Each investor's personal link shows every update and records when they open one. Preview never counts as an open, and nothing you open while logged in counts either.</p>
<section class="card"><h2>Add investor</h2>
<form method="post" action="/recipients" class="grid3">
<label>Name<input name="name" required></label>
<label>Email<input name="email" type="email" required></label>
<label>Firm <span class="muted small">optional</span><input name="firm"></label>
<button class="btn primary">Add investor</button></form></section>`,
  });
}

export function settingsPage(c: Company, mcpUrl: string, flash: any) {
  return layout({
    title: "Connect Claude · Ledgerline",
    nav: appNav(c.name, "/settings"),
    head: `<script src="/static/app.js" defer></script>`,
    body: `${flashBox(flash)}<div class="page-head"><h1>Connect Claude</h1></div>
<section class="card"><h2>Your MCP connector URL</h2>
<div class="row gap wrap-sm"><input class="copy big grow" readonly value="${esc(mcpUrl)}" onclick="this.select()"><button type="button" class="btn" data-copy="${esc(mcpUrl)}">Copy</button></div>
<p class="muted small">The secret in this URL identifies the ${esc(c.name)} workspace, so no OAuth is needed. Treat it like a password.</p>
<ol class="steps">
<li>In Claude (claude.ai or the desktop app), open <strong>Settings → Connectors</strong>.</li>
<li>Click <strong>Add custom connector</strong>. Name it <em>Ledgerline</em> and paste the URL above. Leave OAuth fields empty. Click <strong>Add</strong>.</li>
<li>In a new chat, open the tools menu and make sure <strong>Ledgerline</strong> is enabled.</li>
<li>Try: <em>"Use Ledgerline to draft my November 2026 investor update. MRR $524k, revenue $533k, cash $920k, net burn $65k, headcount 32, churned MRR $5.5k, expansion MRR $12k. Highlights: … "</em></li>
</ol></section>
<section class="card"><h2>Monthly reminder</h2>
<p class="small">On the 1st of each month, Ledgerline emails the founder if there's no update yet for the month that just ended.</p>
<form method="post" action="/settings" class="row gap wrap-sm">
<label class="grow">Founder email<input name="founder_email" type="email" value="${esc(c.founder_email || "")}" placeholder="you@company.com"></label>
<button class="btn">Save</button></form>
<form method="post" action="/settings/reminder-test" class="mt"><button class="btn ghost sm">Run reminder check now (ignores the date)</button></form>
</section>
<section class="card"><h2>Demo data</h2>
<p class="small">Restore the six seeded Acme Payments updates (May–Oct 2026) and their open history. Deletes any other updates and all views. Keeps investors, the share link and this connector URL.</p>
<form method="post" action="/settings/reset-demo" onsubmit="return confirm('Reset demo updates and views?')"><button class="btn ghost sm">Reset demo data</button></form>
</section>`,
  });
}

/** How links on public pages are built, so personal (/u?r=), preview and share (/s) pages reuse one template. */
export type PublicNav = {
  updateHref: (period: string) => string;
  historyHref?: string;
  historyLabel?: string;
  banner?: string;
};

export function publicUpdatePage(c: Company, u: Update, prev: Update | null, published: Update[], nav: PublicNav) {
  const k = deriveKpis(u.period, u.metrics, prev?.metrics);
  const timeline = published.map((p) => `<li class="${p.id === u.id ? "current" : ""}"><a href="${esc(nav.updateHref(p.period))}">${esc(periodLabel(p.period))}</a>
<span class="muted small">${esc(fmtMetric("mrr", p.metrics.mrr))} MRR</span></li>`).join("");
  const upto = published.filter((p) => p.period <= u.period);
  return layout({
    title: `${c.name} · ${periodLabel(u.period)} update`,
    footer: true,
    body: `${nav.banner ? `<div class="flash info">${esc(nav.banner)}</div>` : ""}
<div class="pub">
<div class="pub-main">
<div class="pub-head"><div class="muted">${esc(c.name)}${nav.historyHref ? ` · <a href="${esc(nav.historyHref)}">${esc(nav.historyLabel || "All updates")}</a>` : ""}</div>
<h1>${esc(periodLabel(u.period))} update</h1>
<p class="muted small">From ${esc(c.founder_name)}${u.published_at ? ` · ${fmtDate(u.published_at)}` : ""}</p></div>
${healthLine(k)}
${updateBody(u, prev)}
<section class="card"><h2>Trends</h2>${trendsPanel(upto.length ? upto : [u])}</section>
</div>
<aside class="pub-side"><h3>Previous updates</h3><ul class="timeline">${timeline || `<li class="muted">None yet</li>`}</ul></aside>
</div>`,
  });
}

/** Full history: used by the investor page (/i/{token}) and the company share page (/s/{token}). */
export function historyPage(c: Company, published: Update[], opts: { greeting: string; updateHref: (period: string) => string; banner?: string; title: string }) {
  const rows = withKpis(published);
  const cards = rows.map(({ u, k, prev }) => `<article class="card hist"><div class="row between"><h2><a href="${esc(opts.updateHref(u.period))}">${esc(periodLabel(u.period))}</a></h2>
<span class="muted small">${fmtDate(u.published_at)}</span></div>
<p class="small hist-summary">${esc(k.summary)}</p>
${metricsTable(u, prev)}
${u.highlights.length ? `<ul class="compact">${u.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
<a class="btn sm" href="${esc(opts.updateHref(u.period))}">Read full update →</a></article>`).join("");
  return layout({
    title: opts.title,
    footer: true,
    body: `${opts.banner ? `<div class="flash info">${esc(opts.banner)}</div>` : ""}
<div class="pub-head"><div class="muted">${esc(opts.greeting)}</div><h1>${esc(c.name)}</h1>
<p class="muted small">${published.length} published update${published.length === 1 ? "" : "s"} · newest first</p></div>
${rows.length ? healthLine(rows[0].k, `Latest (${periodLabel(rows[0].u.period)})`) : ""}
${rows.length ? kpiPanel(rows[0].k) : ""}
<section class="card"><h2>Trends</h2>${trendsPanel(published)}</section>
${cards || `<p class="muted">No updates published yet.</p>`}`,
  });
}

export function messagePage(title: string, msg: string, status = "") {
  return layout({ title, footer: true, body: `<div class="card center msg"><h1>${esc(status || title)}</h1><p class="muted">${esc(msg)}</p></div>` });
}

export function notFound(msg = "Not found") {
  return messagePage("Not found", msg, "404");
}
