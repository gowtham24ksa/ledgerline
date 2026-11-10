import { Marked } from "marked";
import type { Update } from "./db.js";
import { CORE_METRICS, METRIC_LABELS, METRIC_HELP, BURN_MULTIPLE_SOURCE, fmtMetric, monthOnMonth, periodLabel, shortPeriod, runway, isNum, fmtMoney, deriveKpis, renderText, type Band, type Kpis } from "./logic.js";

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const md = new Marked({ gfm: true, breaks: false });
md.use({
  renderer: {
    // Raw HTML in markdown is shown as text, never rendered.
    html(token: any) {
      return esc(token.text);
    },
    link(this: any, token: any) {
      const href = String(token.href || "");
      const inner = this.parser.parseInline(token.tokens);
      if (!/^(https?:|mailto:|\/|#)/i.test(href)) return inner;
      return `<a href="${esc(href)}" rel="noopener nofollow" target="_blank">${inner}</a>`;
    },
    image(token: any) {
      const href = String(token.href || "");
      if (!/^https?:/i.test(href)) return esc(token.text || "");
      return `<img src="${esc(href)}" alt="${esc(token.text || "")}">`;
    },
  },
});

export function renderMarkdown(src: string): string {
  return md.parse(src || "") as string;
}

export function layout(opts: { title: string; body: string; nav?: string; head?: string; footer?: boolean }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<link rel="stylesheet" href="/static/style.css">
${opts.head || ""}
</head><body>
${opts.nav || ""}
<main class="wrap">${opts.body}</main>
${opts.footer ? `<footer class="sent">Sent with <a href="/">Ledgerline</a></footer>` : ""}
</body></html>`;
}

export function appNav(companyName: string, active: string) {
  const item = (href: string, label: string) =>
    `<a href="${href}" class="${active === href ? "active" : ""}">${label}</a>`;
  return `<header class="topbar"><div class="wrap topbar-inner">
<a class="brand" href="/dashboard">Ledgerline</a>
<span class="muted co">${esc(companyName)}</span>
<nav>${item("/dashboard", "Updates")}${item("/recipients", "Investors")}${item("/settings", "Connect Claude")}
<form method="post" action="/logout" class="inline"><button class="linkbtn">Log out</button></form></nav>
</div></header>`;
}

// ---------- charts (plain SVG, no JS) ----------

type Pt = { label: string; value: number | null };

export function lineChart(title: string, pts: Pt[], fmt: (v: number) => string, opts: { color?: string } = {}) {
  const W = 320, H = 150, padL = 8, padR = 8, padT = 22, padB = 22;
  const vals = pts.map((p) => p.value).filter(isNum);
  const last = [...pts].reverse().find((p) => isNum(p.value));
  const head = `<div class="chart"><div class="chart-head"><span>${esc(title)}</span><strong>${last ? esc(fmt(last.value!)) : "—"}</strong></div>`;
  if (vals.length < 1) return head + `<p class="muted small">No data yet.</p></div>`;
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min = min * 0.9; max = max * 1.1 || 1; }
  const span = max - min;
  min -= span * 0.1; max += span * 0.1;
  const n = pts.length;
  const x = (i: number) => (n === 1 ? W / 2 : padL + (i * (W - padL - padR)) / (n - 1));
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const color = opts.color || "var(--accent)";
  let d = "", started = false;
  pts.forEach((p, i) => {
    if (!isNum(p.value)) { started = false; return; }
    d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)} `;
    started = true;
  });
  const dots = pts.map((p, i) => isNum(p.value)
    ? `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="${color}"><title>${esc(p.label)}: ${esc(fmt(p.value))}</title></circle>`
    : "").join("");
  const step = Math.ceil(n / 6);
  const xl = pts.map((p, i) => (i % step === 0 || i === n - 1)
    ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 && n > 1 ? "start" : i === n - 1 && n > 1 ? "end" : "middle"}">${esc(p.label)}</text>` : "").join("");
  const yl = `<text x="${padL}" y="12" text-anchor="start">${esc(fmt(Math.max(...vals)))} max</text>`;
  return head + `<svg viewBox="0 0 ${W} ${H}" class="spark" role="img" aria-label="${esc(title)} trend">
<line x1="${padL}" x2="${W - padR}" y1="${H - padB}" y2="${H - padB}" class="axis"/>
<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
${dots}<g class="lbl">${xl}${yl}</g></svg></div>`;
}

const shortLabel = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" }) + " " + String(y).slice(2);
};

/** MRR, net burn and runway across the given (published) updates, oldest first. */
export function trendsPanel(updates: Update[]) {
  const ups = [...updates].sort((a, b) => a.period.localeCompare(b.period));
  if (!ups.length) return `<p class="muted">Trends appear after the first published update.</p>`;
  const series = (f: (u: Update) => number | null | undefined) => ups.map((u) => ({ label: shortLabel(u.period), value: f(u) ?? null }));
  return `<div class="charts">
${lineChart("MRR", series((u) => u.metrics.mrr), fmtMoney)}
${lineChart("Net burn", series((u) => u.metrics.net_burn), fmtMoney, { color: "var(--warn)" })}
${lineChart("Runway", series((u) => runway(u.metrics)), (v) => `${v} mo`, { color: "var(--good)" })}
</div>`;
}

// ---------- update rendering ----------

function changeBadge(pct: number | null, metric: string) {
  if (pct === null) return "";
  // For burn, going down is good.
  const goodWhenDown = metric === "net_burn";
  const good = goodWhenDown ? pct < 0 : pct > 0;
  const cls = pct === 0 ? "flat" : good ? "up" : "down";
  return `<span class="chg ${cls}">${pct > 0 ? "▲" : pct < 0 ? "▼" : "•"} ${Math.abs(pct)}%</span>`;
}

export function metricsTable(u: Pick<Update, "metrics">, prev: Pick<Update, "metrics"> | null | undefined) {
  const mom = monthOnMonth(u.metrics, prev?.metrics);
  const byKey = new Map(mom.map((m) => [m.metric, m]));
  const rows: string[] = [];
  const row = (key: string, label: string, val: unknown) => {
    const m = byKey.get(key);
    const help = METRIC_HELP[key];
    rows.push(`<div class="metric"${help ? ` title="${esc(help)}"` : ""}><div class="m-label">${esc(label)}</div><div class="m-val">${esc(fmtMetric(key.replace(/^custom\./, ""), val))}</div>${m ? changeBadge(m.change_pct, key) : ""}</div>`);
  };
  for (const k of CORE_METRICS) if ((u.metrics as any)[k] !== undefined) row(k, METRIC_LABELS[k], (u.metrics as any)[k]);
  for (const [k, v] of Object.entries(u.metrics.custom || {})) row("custom." + k, k, v);
  return `<div class="metrics">${rows.join("")}</div>`;
}

function list(title: string, items: string[], cls: string) {
  if (!items?.length) return "";
  return `<section class="list ${cls}"><h3>${esc(title)}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></section>`;
}

export function bandChip(b: Band | null) {
  if (!b) return "";
  return `<span class="band ${b.tone}">${esc(b.label)}</span>`;
}

/** The one-line health summary, e.g. "Growing 8.2% MoM at a 2.4x burn multiple (concerning); …" */
export function healthLine(k: Kpis, label?: string) {
  return `<p class="health"><span class="health-k">${esc(label || "Health")}</span> ${esc(k.summary)}</p>`;
}

/** Derived KPIs with bands, tooltips and a "How to read this" footnote. */
export function kpiPanel(k: Kpis) {
  const cell = (key: string, value: string, band: Band | null = null, sub = "") =>
    `<div class="metric kpi" title="${esc(METRIC_HELP[key] || "")}"><div class="m-label">${esc(METRIC_LABELS[key])}</div>
<div class="m-val">${esc(value)}</div>${band ? bandChip(band) : ""}${sub ? `<div class="muted small">${esc(sub)}</div>` : ""}</div>`;
  const cells: string[] = [];
  if (k.mom_growth_pct !== null) cells.push(cell("mom_growth_pct", fmtMetric("mom_growth_pct", k.mom_growth_pct)));
  if (k.net_new_mrr !== null) cells.push(cell("net_new_mrr", fmtMetric("net_new_mrr", k.net_new_mrr)));
  if (k.burn_multiple !== null || k.burn_multiple_note) cells.push(cell("burn_multiple", k.burn_multiple !== null ? `${k.burn_multiple}x` : k.burn_multiple_note!, k.bands.burn_multiple));
  if (k.runway_months !== null) cells.push(cell("runway_months", `${k.runway_months} mo`, k.bands.runway, k.runway_end_month ? `cash lasts to ${shortPeriod(k.runway_end_month)}` : ""));
  if (k.grr_pct !== null) cells.push(cell("grr_pct", `${k.grr_pct}%`));
  if (k.nrr_pct !== null) cells.push(cell("nrr_pct", `${k.nrr_pct}%`, k.bands.nrr));
  if (k.arr_per_employee !== null) cells.push(cell("arr_per_employee", fmtMoney(k.arr_per_employee)));
  if (!cells.length) return "";
  const used = ["mom_growth_pct", "net_new_mrr", "burn_multiple", "runway_months", "grr_pct", "nrr_pct", "arr_per_employee", "mrr", "cash", "net_burn", "headcount", "churned_mrr", "expansion_mrr"];
  return `<section class="kpis"><h3>Key ratios <span class="muted small">calculated from the numbers above</span></h3>
<div class="metrics">${cells.join("")}</div>
<p class="muted small bands-note">Burn multiple bands: <a href="${esc(BURN_MULTIPLE_SOURCE.url)}" target="_blank" rel="noopener">Benchmark: ${esc(BURN_MULTIPLE_SOURCE.name)}</a> (&lt;1 exceptional · 1–1.5 strong · 1.5–2 solid · 2–3 concerning · &gt;3 red flag). Runway bands are a rule of thumb (&lt;6 critical · 6–12 watch · 12–18 healthy · &gt;18 strong). NRR: &gt;100% expanding · 90–100% stable · &lt;90% leaking.</p>
<details class="howto"><summary>How to read this</summary><dl>${used.map((u) => `<dt>${esc(METRIC_LABELS[u])}</dt><dd>${esc(METRIC_HELP[u])}</dd>`).join("")}</dl></details>
</section>`;
}

export function updateBody(u: Update, prev: Update | null | undefined) {
  const k = deriveKpis(u.period, u.metrics, prev?.metrics);
  const t = renderText(u, prev?.metrics, k); // {{placeholders}} filled from the metrics
  return `${metricsTable(u, prev)}
${kpiPanel(k)}
<div class="lists">${list("Highlights", t.highlights, "hi")}${list("Lowlights", t.lowlights, "lo")}${list("Asks", t.asks, "ask")}</div>
<article class="prose">${renderMarkdown(t.body_markdown)}</article>`;
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export { periodLabel };
