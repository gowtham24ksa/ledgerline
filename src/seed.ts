import crypto from "node:crypto";
import { q, one, type Company } from "./db.js";
import { hashPassword } from "./auth.js";
import { newToken } from "./services.js";

// Demo login (test credentials for this demo app only).
export const DEMO_USERNAME = "founder@acme.test";
export const DEMO_PASSWORD = "ledgerline-demo";

/** Bump when seeded updates/views change; boot re-applies demo data once per version. */
export const SEED_VERSION = "3"; // v3: seeded text uses {{placeholders}}

/*
 * Six-month story (all fictional):
 *  MRR $300k → $478k, ~10% MoM. Burn falls as growth rises, so the burn multiple
 *  (net burn ÷ net new MRR) improves from concerning (2.8x) to solid (1.67x).
 *  Runway stays around 14 months.
 *
 *  period  mrr     netnew burn  BM    cash       runway
 *  05      300.0k  —      95k   —     1,367k     14.4
 *  06      330.0k  30.0k  84k   2.80  1,283k     15.3
 *  07      362.0k  32.0k  80k   2.50  1,203k     15.0
 *  08      398.0k  36.0k  76k   2.11  1,127k     14.8
 *  09      436.0k  38.0k  72k   1.89  1,055k     14.7
 *  10      478.0k  42.0k  70k   1.67    985k     14.1
 */
const months = [
  {
    period: "2026-05",
    metrics: { mrr: 300000, revenue: 306000, cash: 1367000, net_burn: 95000, headcount: 24, churned_mrr: 3900, expansion_mrr: 6100, custom: { customers: 214 } },
    highlights: ["MRR reached {{mrr}}", "Signed Northgate Credit Union, our first bank partner", "Same-day payouts live for every merchant"],
    lowlights: ["Burn is still too high for our growth rate (we'll start reporting burn multiple next month)"],
    asks: ["Intros to Heads of Payments at regional banks"],
    body: `Hi all,

May was a **foundation month**. MRR reached {{mrr}}, signed Northgate Credit Union as our first bank partner and shipped same-day payouts to every merchant.

Net burn was {{net_burn}} with {{cash}} in the bank, {{runway}} of runway ({{runway_band}}). Burn is higher than it should be for our growth, so from June we'll report our burn multiple every month and drive it down.

— Priya`,
  },
  {
    period: "2026-06",
    metrics: { mrr: 330000, revenue: 337000, cash: 1283000, net_burn: 84000, headcount: 25, churned_mrr: 4200, expansion_mrr: 7400, custom: { customers: 239 } },
    highlights: ["MRR up {{mom_growth}} to {{mrr}}", "Net burn down to {{net_burn}} after renegotiating processor fees", "Hired a senior backend engineer from a top-5 card issuer"],
    lowlights: ["Burn multiple of {{burn_multiple}} ({{burn_band}}): we're spending too much per new dollar of MRR", "Chargebacks hit 0.4% after a fraud wave in ticketing"],
    asks: ["Advice on fraud vendors that work well under $10M monthly volume"],
    body: `Hi all,

June MRR reached **{{mrr}} (+{{mom_growth}})** and we cut net burn to {{net_burn}} by renegotiating processor fees.

Our burn multiple was **{{burn_multiple}}**, in the {{burn_band}} band. The plan: hold headcount growth below revenue growth and push self-serve onboarding so sales cost per merchant falls.

Chargebacks rose to 0.4% after a fraud wave in ticketing; velocity rules are live and we expect to be back under 0.2% in July.

— Priya`,
  },
  {
    period: "2026-07",
    metrics: { mrr: 362000, revenue: 369000, cash: 1203000, net_burn: 80000, headcount: 26, churned_mrr: 4000, expansion_mrr: 8000, custom: { customers: 263 } },
    highlights: ["MRR up {{mom_growth}} to {{mrr}}", "Self-serve onboarding launched: 40% of new merchants signed up without sales", "Chargebacks back down to 0.15%"],
    lowlights: ["Burn multiple still {{burn_band}} at {{burn_multiple}}", "Largest enterprise deal (a marketplace) slipped to Q4"],
    asks: ["Warm intro to the CFO of a large online marketplace"],
    body: `Hi all,

July MRR was **{{mrr}} (+{{mom_growth}})**. Self-serve onboarding went live and 40% of new merchants signed up without talking to sales.

Burn multiple improved to **{{burn_multiple}}**, still {{burn_band}} but moving the right way. Chargebacks are back to 0.15%.

Our biggest pipeline deal, a marketplace, slipped to Q4.

— Priya`,
  },
  {
    period: "2026-08",
    metrics: { mrr: 398000, revenue: 406000, cash: 1127000, net_burn: 76000, headcount: 27, churned_mrr: 4300, expansion_mrr: 9100, custom: { customers: 290 } },
    highlights: ["MRR up {{mom_growth}} to {{mrr}}", "Second bank partner (Harbor Federal) signed", "Monthly NRR at {{nrr}}, above 100% for the third month running"],
    lowlights: ["Lost one mid-size merchant to a competitor on price", "Burn multiple {{burn_multiple}}: just above our 2.0x target"],
    asks: ["Candidates for a VP Sales with bank partnership experience"],
    body: `Hi all,

August MRR reached **{{mrr}} (+{{mom_growth}})** and Harbor Federal became our second bank partner.

Burn multiple was **{{burn_multiple}}**, just above our 2.0x target. Existing merchants keep growing: monthly NRR was {{nrr}}, above 100% for the third month running.

We lost one mid-size merchant on price and are reviewing pricing for high-volume tiers.

— Priya`,
  },
  {
    period: "2026-09",
    metrics: { mrr: 436000, revenue: 445000, cash: 1055000, net_burn: 72000, headcount: 28, churned_mrr: 4500, expansion_mrr: 10500, custom: { customers: 318 } },
    highlights: ["MRR up {{mom_growth}} to {{mrr}}", "Burn multiple under 2.0x for the first time ({{burn_multiple}}, {{burn_band}})", "New high-volume pricing tier stopped price-driven churn"],
    lowlights: ["VP Sales search still open after 6 weeks"],
    asks: ["Intros to VP Sales candidates"],
    body: `Hi all,

September MRR was **{{mrr}} (+{{mom_growth}})**. Our burn multiple dropped below 2.0x for the first time, to **{{burn_multiple}}**.

The new high-volume pricing tier is working: no price-driven churn this month. We have {{cash}} in the bank, {{runway}} of runway.

Hiring a VP Sales is now the top priority.

— Priya`,
  },
  {
    period: "2026-10",
    metrics: { mrr: 478000, revenue: 488000, cash: 985000, net_burn: 70000, headcount: 29, churned_mrr: 4700, expansion_mrr: 12100, custom: { customers: 341 } },
    highlights: ["MRR up {{mom_growth}} to {{mrr}}", "Burn multiple improved to {{burn_multiple}} ({{burn_band}})", "Marketplace enterprise deal signed, live in December"],
    lowlights: ["Runway is {{runway}} ({{runway_band}}); we want 18+ months before a Series A process"],
    asks: ["Intros to VP Sales candidates", "Feedback on our Series A narrative"],
    body: `Hi all,

October was our strongest month yet: MRR reached **{{mrr}} (+{{mom_growth}})** and we signed the marketplace deal that slipped in July. It goes live in December.

Burn multiple improved again to **{{burn_multiple}}** ({{burn_band}}). We have {{cash}} in the bank, {{runway}} of runway, enough to last until {{runway_end}}.

We're starting Series A prep for Q2 next year and would love feedback on the narrative.

— Priya`,
  },
];

const investors = [
  { name: "Maya Lindqvist", email: "maya@northstar-ventures.test", firm: "Northstar Ventures" },
  { name: "Daniel Okafor", email: "daniel@bluepeak.test", firm: "Bluepeak Capital" },
  { name: "Sofia Marin", email: "sofia.marin@angel.test", firm: "Angel investor" },
];

/**
 * Fixed open history: hours after publishing that each seeded investor first opened each update
 * (null = never opened). Maya reads everything quickly, Daniel most things, Sofia skims.
 */
const opens: Record<string, (number | null)[]> = {
  "maya@northstar-ventures.test": [2, 1.5, 3, 2, 1, 2.5],
  "daniel@bluepeak.test": [20, 26, null, 18, 30, 22],
  "sofia.marin@angel.test": [48, null, 70, null, 52, null],
};

const publishedAt = (period: string) => {
  const [y, mo] = period.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 4, 15, 0)); // 4th of the following month, 15:00 UTC
};

export async function getMeta(key: string) {
  return (await one<{ value: string }>("SELECT value FROM app_meta WHERE key = $1", [key]))?.value;
}
async function setMeta(key: string, value: string) {
  await q("INSERT INTO app_meta (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]);
}

/** Fresh database: create everything. Existing database on an older seed version: refresh demo data in place. */
export async function seedOnBoot(): Promise<string | null> {
  const c = await one<Company>("SELECT * FROM companies ORDER BY id LIMIT 1");
  if (!c) {
    await seed();
    return "seeded";
  }
  if ((await getMeta("seed_version")) !== SEED_VERSION && c.slug === "acme-payments") {
    await resetDemoData(c.id);
    return "refreshed";
  }
  return null;
}

/**
 * Replace all updates and views with the seeded six months and fixed open history.
 * Keeps the company (and its MCP connector URL), login, investors and share links.
 */
export async function resetDemoData(companyId: number) {
  await q("DELETE FROM views WHERE update_id IN (SELECT id FROM updates WHERE company_id = $1)", [companyId]);
  await q("DELETE FROM updates WHERE company_id = $1", [companyId]);
  const recips = await q<{ id: number; email: string }>("SELECT id, email FROM recipients WHERE company_id = $1", [companyId]);
  for (const [idx, m] of months.entries()) {
    const at = publishedAt(m.period);
    const u = (await one<{ id: number }>(
      `INSERT INTO updates (company_id, period, status, metrics, highlights, lowlights, asks, body_markdown, created_via, published_at, created_at, updated_at)
       VALUES ($1,$2,'published',$3,$4,$5,$6,$7,$8,$9,$9,$9) RETURNING id`,
      [companyId, m.period, JSON.stringify(m.metrics), JSON.stringify(m.highlights), JSON.stringify(m.lowlights),
        JSON.stringify(m.asks), m.body, idx < 2 ? "app" : "claude", at],
    ))!;
    for (const r of recips) {
      const h = opens[r.email]?.[idx];
      if (h === null || h === undefined) continue;
      await q("INSERT INTO views (update_id, recipient_id, viewed_at) VALUES ($1,$2,$3)", [u.id, r.id, new Date(at.getTime() + h * 3600_000)]);
    }
  }
  await q("DELETE FROM email_log WHERE company_id = $1 AND kind = 'reminder'", [companyId]);
  await setMeta("seed_version", SEED_VERSION);
}

/** Wipe everything and create the demo workspace from scratch (local use: npm run seed). */
export async function seed() {
  await q("TRUNCATE companies, users, updates, recipients, views, email_log, share_links RESTART IDENTITY CASCADE");
  const secret = crypto.randomBytes(24).toString("base64url");
  const company = (await one<Company>(
    "INSERT INTO companies (name, slug, founder_name, founder_email, mcp_secret, created_at) VALUES ($1,$2,$3,$4,$5,'2026-04-20') RETURNING *",
    ["Acme Payments", "acme-payments", "Priya Raman", null, secret],
  ))!;
  await q("INSERT INTO users (company_id, username, password_hash) VALUES ($1,$2,$3)", [
    company.id, DEMO_USERNAME, hashPassword(DEMO_PASSWORD),
  ]);
  for (const i of investors) {
    await q(
      "INSERT INTO recipients (company_id, name, email, firm, token, created_at) VALUES ($1,$2,$3,$4,$5,'2026-04-25')",
      [company.id, i.name, i.email, i.firm, newToken()],
    );
  }
  await resetDemoData(company.id);
  return company;
}
