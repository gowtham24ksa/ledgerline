// Plain arithmetic and fixed thresholds only. No AI anywhere in this app.
import type { Metrics, Update } from "./db.js";

/** Metrics a founder can enter. */
export const INPUT_METRICS = ["mrr", "revenue", "cash", "net_burn", "headcount", "churned_mrr", "expansion_mrr"] as const;
/** Metrics we warn about when missing. */
export const REQUIRED_METRICS = ["mrr", "cash", "net_burn", "headcount"] as const;
/** Kept for older imports. */
export const CORE_METRICS = INPUT_METRICS;

export const METRIC_LABELS: Record<string, string> = {
  mrr: "MRR",
  revenue: "Revenue",
  cash: "Cash",
  net_burn: "Net burn",
  headcount: "Headcount",
  churned_mrr: "Churned MRR",
  expansion_mrr: "Expansion MRR",
  runway_months: "Runway",
  mom_growth_pct: "MoM growth",
  net_new_mrr: "Net new MRR",
  burn_multiple: "Burn multiple",
  grr_pct: "Monthly GRR",
  nrr_pct: "Monthly NRR",
  arr_per_employee: "ARR per employee",
};

/** One plain sentence per metric, shown as tooltips and in the "How to read this" footnote. */
export const METRIC_HELP: Record<string, string> = {
  mrr: "Monthly recurring revenue at month end: what customers pay every month on their current plans.",
  revenue: "All revenue recognised in the month, including one-off fees.",
  cash: "Cash in the bank at the end of the month.",
  net_burn: "Cash that left the business this month after counting cash that came in.",
  headcount: "Full-time people on the team at month end.",
  churned_mrr: "Monthly recurring revenue lost from customers who cancelled or downgraded this month.",
  expansion_mrr: "Extra monthly recurring revenue from existing customers who upgraded or bought more.",
  runway_months: "How many months the cash lasts at this month's burn (cash ÷ net burn); the date shows when it runs out.",
  mom_growth_pct: "How much MRR grew compared with the previous month.",
  net_new_mrr: "MRR added this month after churn: this month's MRR minus last month's.",
  burn_multiple: "Dollars burned for each new dollar of recurring revenue (net burn ÷ net new MRR); lower is more efficient.",
  grr_pct: "Share of last month's MRR kept after churn, ignoring upgrades; 100% means nobody left.",
  nrr_pct: "Last month's MRR after churn plus upgrades, as a share of last month's; above 100% means existing customers grow on their own.",
  arr_per_employee: "Annualised recurring revenue (MRR × 12) per person on the team; a rough productivity measure.",
};

export const BURN_MULTIPLE_SOURCE = { name: "CRV", url: "https://www.crv.com/content/burn-multiple" };

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** runway_months = cash / net_burn. null if not computable or burn <= 0 (not burning). */
export function runway(m: Metrics | undefined | null): number | null {
  if (!m || !isNum(m.cash) || !isNum(m.net_burn) || m.net_burn <= 0) return null;
  return r1(m.cash / m.net_burn);
}

export function pctChange(prev: unknown, cur: unknown): number | null {
  if (!isNum(prev) || !isNum(cur) || prev === 0) return null;
  return r1(((cur - prev) / Math.abs(prev)) * 100);
}

// ---------------- bands ----------------

export type Tone = "good" | "ok" | "warn" | "bad";
export type Band = { label: string; tone: Tone; basis: string; source?: { name: string; url: string } };

export function burnMultipleBand(bm: number): Band {
  const b = (label: string, tone: Tone): Band => ({ label, tone, basis: "Benchmark: CRV", source: BURN_MULTIPLE_SOURCE });
  if (bm < 1) return b("exceptional", "good");
  if (bm < 1.5) return b("strong", "good");
  if (bm < 2) return b("solid", "ok");
  if (bm <= 3) return b("concerning", "warn");
  return b("red flag", "bad");
}

export function runwayBand(months: number): Band {
  const b = (label: string, tone: Tone): Band => ({ label, tone, basis: "Rule of thumb" });
  if (months < 6) return b("critical", "bad");
  if (months < 12) return b("watch", "warn");
  if (months <= 18) return b("healthy", "ok");
  return b("strong", "good");
}

export function nrrBand(pct: number): Band {
  const b = (label: string, tone: Tone): Band => ({ label, tone, basis: "Rule of thumb" });
  if (pct > 100) return b("expanding", "good");
  if (pct >= 90) return b("stable", "ok");
  return b("leaking", "bad");
}

// ---------------- derived KPIs ----------------

export type Kpis = {
  mom_growth_pct: number | null;
  net_new_mrr: number | null;
  burn_multiple: number | null;
  burn_multiple_note: string | null;
  runway_months: number | null;
  runway_end_month: string | null;
  grr_pct: number | null;
  nrr_pct: number | null;
  arr_per_employee: number | null;
  bands: { burn_multiple: Band | null; runway: Band | null; nrr: Band | null };
  summary: string;
};

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** All derived metrics for a period. Needs the previous period for growth, burn multiple, GRR and NRR. */
export function deriveKpis(period: string, m: Metrics, prev: Metrics | null | undefined): Kpis {
  const prevMrr = prev && isNum(prev.mrr) && prev.mrr > 0 ? prev.mrr : null;
  const mrr = isNum(m.mrr) ? m.mrr : null;
  const net_new_mrr = prevMrr !== null && mrr !== null ? mrr - prevMrr : null;
  const mom_growth_pct = prevMrr !== null && mrr !== null ? r1(((mrr - prevMrr) / prevMrr) * 100) : null;

  let burn_multiple: number | null = null;
  let burn_multiple_note: string | null = null;
  if (net_new_mrr !== null && isNum(m.net_burn)) {
    if (m.net_burn <= 0) burn_multiple_note = "n/a – not burning cash";
    else if (net_new_mrr <= 0) burn_multiple_note = "n/a – no net new revenue";
    // Net burn ÷ net new ARR, both annualised: (net_burn*12)/(net_new_mrr*12) = net_burn/net_new_mrr.
    else burn_multiple = r2(m.net_burn / net_new_mrr);
  }

  const runway_months = runway(m);
  const runway_end_month = runway_months !== null ? addMonths(period, Math.floor(runway_months)) : null;

  const grr_pct = prevMrr !== null && isNum(m.churned_mrr) ? r1(((prevMrr - m.churned_mrr) / prevMrr) * 100) : null;
  const nrr_pct = prevMrr !== null && isNum(m.churned_mrr) && isNum(m.expansion_mrr)
    ? r1(((prevMrr - m.churned_mrr + m.expansion_mrr) / prevMrr) * 100) : null;
  const arr_per_employee = mrr !== null && isNum(m.headcount) && m.headcount > 0 ? Math.round((mrr * 12) / m.headcount) : null;

  const bands = {
    burn_multiple: burn_multiple !== null ? burnMultipleBand(burn_multiple) : null,
    runway: runway_months !== null ? runwayBand(runway_months) : null,
    nrr: nrr_pct !== null ? nrrBand(nrr_pct) : null,
  };

  const k: Kpis = { mom_growth_pct, net_new_mrr, burn_multiple, burn_multiple_note, runway_months, runway_end_month, grr_pct, nrr_pct, arr_per_employee, bands, summary: "" };
  k.summary = healthSummary(k, m);
  return k;
}

/** e.g. "Growing 8.2% MoM at a 2.4x burn multiple (concerning); 11 months of runway (watch)." */
export function healthSummary(k: Kpis, m: Metrics): string {
  let first: string;
  if (k.mom_growth_pct === null) first = isNum(m.mrr) ? `MRR at ${fmtMoney(m.mrr)}` : "No MRR reported";
  else if (k.mom_growth_pct > 0) first = `Growing ${k.mom_growth_pct}% MoM`;
  else if (k.mom_growth_pct < 0) first = `MRR down ${Math.abs(k.mom_growth_pct)}% MoM`;
  else first = "Flat MRR month on month";
  if (k.burn_multiple !== null) first += ` at a ${k.burn_multiple}x burn multiple (${k.bands.burn_multiple!.label})`;
  else if (k.burn_multiple_note === "n/a – no net new revenue") first += " with no net new revenue";
  const parts = [first];
  if (k.runway_months !== null) parts.push(`${k.runway_months} months of runway (${k.bands.runway!.label})`);
  else if (isNum(m.net_burn) && m.net_burn <= 0) parts.push("not burning cash");
  if (k.nrr_pct !== null) parts.push(`NRR ${k.nrr_pct}% (${k.bands.nrr!.label})`);
  return parts.join("; ") + ".";
}

// ---------------- month-on-month + checks ----------------

export type MoM = { metric: string; previous: number | null; current: number | null; change_pct: number | null };

export function monthOnMonth(cur: Metrics, prev: Metrics | null | undefined): MoM[] {
  const out: MoM[] = [];
  const keys = new Set<string>([...INPUT_METRICS]);
  for (const k of Object.keys(cur.custom || {})) keys.add("custom." + k);
  for (const k of keys) {
    const get = (m: Metrics | null | undefined) =>
      !m ? null : k.startsWith("custom.") ? (m.custom || {})[k.slice(7)] : (m as any)[k];
    const c = get(cur), p = get(prev);
    if (!isNum(c) && !isNum(p)) continue;
    out.push({ metric: k, previous: isNum(p) ? p : null, current: isNum(c) ? c : null, change_pct: pctChange(p, c) });
  }
  const rc = runway(cur), rp = runway(prev);
  if (rc !== null || rp !== null) out.push({ metric: "runway_months", previous: rp, current: rc, change_pct: pctChange(rp, rc) });
  return out;
}

/** Find runway claims like "18 months of runway", "runway of ~14 months". */
export function statedRunways(text: string): number[] {
  const found: number[] = [];
  const res = [
    /(\d+(?:\.\d+)?)\s*\+?\s*(?:months?|mos?\.?)\s+(?:of\s+)?runway/gi,
    /runway[^.\d\n]{0,25}?(\d+(?:\.\d+)?)\s*(?:months?|mos?\b)/gi,
  ];
  for (const re of res) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      // "runway extended by 2 months" is a delta, not a level.
      if (/\bby\b|extend|add|gain|los[ets]|cut/i.test(m[0])) continue;
      found.push(Number(m[1]));
    }
  }
  return [...new Set(found)];
}

export type Checks = {
  computed_runway_months: number | null;
  month_on_month: MoM[];
  compared_to_period: string | null;
  warnings: string[];
};

export function runChecks(u: Pick<Update, "metrics" | "highlights" | "lowlights" | "asks" | "body_markdown"> & { period?: string }, prev: Update | null): Checks {
  const warnings: string[] = [];
  const m = u.metrics || {};
  const rw = runway(m);
  for (const k of REQUIRED_METRICS) {
    if (!isNum((m as any)[k])) warnings.push(`Missing metric "${k}".`);
  }
  if (isNum(m.net_burn) && m.net_burn <= 0) warnings.push("net_burn is zero or negative, so runway is not computed (company is not burning cash).");
  // Check the text as readers will see it (placeholders filled in).
  const shown = renderText({ period: u.period || "2000-01", metrics: m, highlights: u.highlights || [], lowlights: u.lowlights || [], asks: u.asks || [], body_markdown: u.body_markdown || "" }, prev?.metrics);
  const text = [shown.body_markdown, ...shown.highlights, ...shown.lowlights, ...shown.asks].join("\n");
  for (const s of statedRunways(text)) {
    if (rw === null) warnings.push(`Text states ${s} months of runway but runway cannot be computed from cash/net_burn.`);
    else if (Math.abs(s - rw) / rw > 0.1)
      warnings.push(`Text states ${s} months of runway, but cash / net_burn = ${rw} months (differs by more than 10%).`);
  }
  const mom = monthOnMonth(m, prev?.metrics);
  for (const x of mom) {
    if (x.change_pct !== null && Math.abs(x.change_pct) > 50)
      warnings.push(`${x.metric} moved ${x.change_pct > 0 ? "+" : ""}${x.change_pct}% month on month (${x.previous} → ${x.current}). Double-check the number.`);
  }
  return { computed_runway_months: rw, month_on_month: mom, compared_to_period: prev?.period || null, warnings };
}

// ---------------- formatting ----------------

export function periodLabel(p: string): string {
  const [y, mo] = p.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
export function shortPeriod(p: string): string {
  const [y, mo] = p.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function currentPeriod(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function nextPeriod(p: string): string {
  return addMonths(p, 1);
}

const MONEY = new Set(["mrr", "revenue", "cash", "net_burn", "churned_mrr", "expansion_mrr", "net_new_mrr", "arr_per_employee"]);

export function fmtMetric(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (!isNum(v)) return String(v);
  if (key === "headcount") return String(v);
  if (key === "runway_months") return `${v} mo`;
  if (key === "burn_multiple") return `${v}x`;
  if (key.endsWith("_pct")) return `${v}%`;
  if (MONEY.has(key)) return fmtMoney(v);
  return v.toLocaleString("en-US");
}

export function fmtMoney(v: number): string {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return `${s}$${a}`;
}

// ---------------- live number placeholders ----------------
// Text fields may contain {{token}} placeholders that are filled from the metrics at display time,
// so prose never goes stale when a number is edited. Unknown tokens are left untouched.

export const PLACEHOLDERS: { token: string; help: string }[] = [
  { token: "month", help: "Period name, e.g. October 2026" },
  { token: "mrr", help: "MRR, e.g. $478k" },
  { token: "arr", help: "MRR × 12" },
  { token: "revenue", help: "Revenue" },
  { token: "cash", help: "Cash in the bank" },
  { token: "net_burn", help: "Net burn" },
  { token: "headcount", help: "Headcount" },
  { token: "churned_mrr", help: "Churned MRR" },
  { token: "expansion_mrr", help: "Expansion MRR" },
  { token: "mom_growth", help: "MoM MRR growth, e.g. 9.6%" },
  { token: "net_new_mrr", help: "Net new MRR" },
  { token: "burn_multiple", help: "Burn multiple, e.g. 1.67x" },
  { token: "burn_band", help: "Burn multiple band, e.g. solid" },
  { token: "runway", help: "Runway, e.g. 14.1 months" },
  { token: "runway_band", help: "Runway band, e.g. healthy" },
  { token: "runway_end", help: "Month cash runs out, e.g. Dec 2027" },
  { token: "grr", help: "Monthly GRR" },
  { token: "nrr", help: "Monthly NRR" },
  { token: "nrr_band", help: "NRR band" },
  { token: "arr_per_employee", help: "ARR per employee" },
  { token: "custom.NAME", help: "A custom metric, e.g. {{custom.customers}}" },
];

export function placeholderValues(period: string, m: Metrics, k: Kpis): Record<string, string> {
  const na = "n/a";
  const v = (key: string) => (isNum((m as any)[key]) ? fmtMetric(key, (m as any)[key]) : na);
  const out: Record<string, string> = {
    month: periodLabel(period),
    mrr: v("mrr"), revenue: v("revenue"), cash: v("cash"), net_burn: v("net_burn"), headcount: v("headcount"),
    churned_mrr: v("churned_mrr"), expansion_mrr: v("expansion_mrr"),
    arr: isNum(m.mrr) ? fmtMoney(m.mrr * 12) : na,
    mom_growth: k.mom_growth_pct !== null ? `${k.mom_growth_pct}%` : na,
    net_new_mrr: k.net_new_mrr !== null ? fmtMoney(k.net_new_mrr) : na,
    burn_multiple: k.burn_multiple !== null ? `${k.burn_multiple}x` : k.burn_multiple_note || na,
    burn_band: k.bands.burn_multiple?.label || na,
    runway: k.runway_months !== null ? `${k.runway_months} months` : na,
    runway_band: k.bands.runway?.label || na,
    runway_end: k.runway_end_month ? shortPeriod(k.runway_end_month) : na,
    grr: k.grr_pct !== null ? `${k.grr_pct}%` : na,
    nrr: k.nrr_pct !== null ? `${k.nrr_pct}%` : na,
    nrr_band: k.bands.nrr?.label || na,
    arr_per_employee: k.arr_per_employee !== null ? fmtMoney(k.arr_per_employee) : na,
  };
  for (const [ck, cv] of Object.entries(m.custom || {})) out["custom." + ck.toLowerCase()] = isNum(cv) ? cv.toLocaleString("en-US") : String(cv);
  return out;
}

export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return (text || "").replace(/\{\{\s*([a-zA-Z0-9_.%\- ]+?)\s*\}\}/g, (whole, key: string) => {
    const k = key.toLowerCase();
    return k in values ? values[k] : whole;
  });
}

/** Returns a copy of the update's text fields with placeholders filled in. */
export function renderText<T extends { period: string; metrics: Metrics; highlights: string[]; lowlights: string[]; asks: string[]; body_markdown: string }>(
  u: T, prev: Metrics | null | undefined, k?: Kpis,
): T {
  const kp = k || deriveKpis(u.period, u.metrics, prev);
  const vals = placeholderValues(u.period, u.metrics, kp);
  const f = (s: string) => fillPlaceholders(s, vals);
  return { ...u, highlights: (u.highlights || []).map(f), lowlights: (u.lowlights || []).map(f), asks: (u.asks || []).map(f), body_markdown: f(u.body_markdown) };
}
