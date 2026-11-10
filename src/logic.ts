// Plain arithmetic only. No AI anywhere in this app.
import type { Metrics, Update } from "./db.js";

export const CORE_METRICS = ["mrr", "revenue", "cash", "net_burn", "headcount"] as const;
export type CoreMetric = (typeof CORE_METRICS)[number];

export const METRIC_LABELS: Record<string, string> = {
  mrr: "MRR",
  revenue: "Revenue",
  cash: "Cash",
  net_burn: "Net burn",
  headcount: "Headcount",
  runway_months: "Runway (months)",
};

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** runway_months = cash / net_burn. null if not computable or burn <= 0 (default alive). */
export function runway(m: Metrics | undefined | null): number | null {
  if (!m || !isNum(m.cash) || !isNum(m.net_burn) || m.net_burn <= 0) return null;
  return Math.round((m.cash / m.net_burn) * 10) / 10;
}

export function pctChange(prev: unknown, cur: unknown): number | null {
  if (!isNum(prev) || !isNum(cur) || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

export type MoM = { metric: string; previous: number | null; current: number | null; change_pct: number | null };

/** Month-on-month change for every numeric metric (core + numeric custom). */
export function monthOnMonth(cur: Metrics, prev: Metrics | null | undefined): MoM[] {
  const out: MoM[] = [];
  const keys = new Set<string>([...CORE_METRICS]);
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

/** Find runway claims like "18 months of runway", "runway of ~14 months", "runway: 12 mo". */
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

export function runChecks(u: Pick<Update, "metrics" | "highlights" | "lowlights" | "asks" | "body_markdown">, prev: Update | null): Checks {
  const warnings: string[] = [];
  const m = u.metrics || {};
  const rw = runway(m);
  for (const k of CORE_METRICS) {
    if (!isNum((m as any)[k])) warnings.push(`Missing core metric "${k}".`);
  }
  if (isNum(m.net_burn) && m.net_burn <= 0) warnings.push("net_burn is zero or negative, so runway is not computed (company is not burning cash).");
  const text = [u.body_markdown, ...(u.highlights || []), ...(u.lowlights || []), ...(u.asks || [])].join("\n");
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

export function periodLabel(p: string): string {
  const [y, mo] = p.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function currentPeriod(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function nextPeriod(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function fmtMetric(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (!isNum(v)) return String(v);
  if (key === "headcount") return String(v);
  if (key === "runway_months") return `${v} mo`;
  if (["mrr", "revenue", "cash", "net_burn"].includes(key)) return fmtMoney(v);
  return v.toLocaleString("en-US");
}

export function fmtMoney(v: number): string {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return `${s}$${a}`;
}
