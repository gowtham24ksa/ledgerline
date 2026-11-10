import { Marked } from "marked";
import type { Update } from "./db.js";
import { CORE_METRICS, METRIC_LABELS, fmtMetric, monthOnMonth, periodLabel, runway, isNum, fmtMoney } from "./logic.js";

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
    rows.push(`<div class="metric"><div class="m-label">${esc(label)}</div><div class="m-val">${esc(fmtMetric(key.replace(/^custom\./, ""), val))}</div>${m ? changeBadge(m.change_pct, key) : ""}</div>`);
  };
  for (const k of CORE_METRICS) if ((u.metrics as any)[k] !== undefined) row(k, METRIC_LABELS[k], (u.metrics as any)[k]);
  const rw = runway(u.metrics);
  if (rw !== null) row("runway_months", "Runway", rw);
  for (const [k, v] of Object.entries(u.metrics.custom || {})) row("custom." + k, k, v);
  return `<div class="metrics">${rows.join("")}</div>`;
}

function list(title: string, items: string[], cls: string) {
  if (!items?.length) return "";
  return `<section class="list ${cls}"><h3>${esc(title)}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></section>`;
}

export function updateBody(u: Update, prev: Update | null | undefined) {
  return `${metricsTable(u, prev)}
<div class="lists">${list("Highlights", u.highlights, "hi")}${list("Lowlights", u.lowlights, "lo")}${list("Asks", u.asks, "ask")}</div>
<article class="prose">${renderMarkdown(u.body_markdown)}</article>`;
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export { periodLabel };
