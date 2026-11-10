import crypto from "node:crypto";
import { q, one } from "./db.js";
import { hashPassword } from "./auth.js";
import { newToken } from "./services.js";

// Demo login (test credentials for this demo app only).
export const DEMO_USERNAME = "founder@acme.test";
export const DEMO_PASSWORD = "ledgerline-demo";

const months = [
  {
    period: "2026-06",
    metrics: { mrr: 82000, revenue: 84500, cash: 2400000, net_burn: 145000, headcount: 18, custom: { customers: 214 } },
    highlights: ["Closed our first bank partner (Northgate Credit Union) on a 2-year contract", "Launched same-day payouts for all merchants"],
    lowlights: ["Two senior engineering offers declined; hiring is slower than planned"],
    asks: ["Intros to Heads of Payments at regional banks"],
    body: `Hi all,

June was a **foundation month**. We signed Northgate Credit Union, our first bank partner, and shipped same-day payouts to every merchant.

MRR grew to $82k. Net burn was $145k, which leaves about 16.6 months of runway.

**Focus for July:** close two more bank partners and fill the senior backend roles.

— Priya`,
  },
  {
    period: "2026-07",
    metrics: { mrr: 91000, revenue: 93200, cash: 2262000, net_burn: 138000, headcount: 19, custom: { customers: 239 } },
    highlights: ["MRR up 11% to $91k", "Hired a senior backend engineer from a top-5 card issuer"],
    lowlights: ["Chargeback rate ticked up to 0.4% after a fraud wave in one merchant segment"],
    asks: ["Advice on fraud vendors that work well under $10M volume"],
    body: `Hi all,

July MRR reached **$91k (+11%)**. We added 25 merchants and hired a senior backend engineer.

The one blemish: a fraud wave in the ticketing segment pushed chargebacks to 0.4%. We've added velocity rules and expect it back under 0.2% in August.

Net burn fell to $138k.

— Priya`,
  },
  {
    period: "2026-08",
    metrics: { mrr: 99500, revenue: 102000, cash: 2131000, net_burn: 131000, headcount: 20, custom: { customers: 263 } },
    highlights: ["Chargebacks back to 0.15%", "Second bank partner (Harbor Federal) signed"],
    lowlights: ["Enterprise deal with a marketplace slipped to Q4"],
    asks: ["Warm intro to the CFO of a large online marketplace"],
    body: `Hi all,

August MRR was **$99.5k**, just shy of the $100k milestone. Chargebacks are back down to 0.15% and Harbor Federal became our second bank partner.

Our largest pipeline deal (a marketplace) slipped to Q4, so September will be lighter on new logos.

— Priya`,
  },
  {
    period: "2026-09",
    metrics: { mrr: 111000, revenue: 113400, cash: 2009000, net_burn: 122000, headcount: 21, custom: { customers: 290 } },
    highlights: ["Crossed $100k MRR, now $111k", "Net burn down 7% while growing 12%"],
    lowlights: ["Lost one mid-size merchant to a competitor on price"],
    asks: ["Candidates for a VP Sales with bank partnership experience"],
    body: `Hi all,

We crossed **$100k MRR** in September and finished at $111k. Burn kept falling, to $122k, thanks to renegotiated processor fees.

We lost one mid-size merchant on price; we're reviewing our pricing tiers for high-volume merchants.

Hiring a VP Sales is now the top priority.

— Priya`,
  },
  {
    period: "2026-10",
    metrics: { mrr: 123500, revenue: 126000, cash: 1897000, net_burn: 112000, headcount: 22, custom: { customers: 318 } },
    highlights: ["MRR up 11% to $123.5k", "Marketplace enterprise deal signed (live in December)", "Runway now about 17 months"],
    lowlights: ["VP Sales search still open after 6 weeks"],
    asks: ["Intros to VP Sales candidates", "Feedback on our Series A narrative"],
    body: `Hi all,

October was our strongest month yet: MRR reached **$123.5k (+11%)** and we signed the marketplace enterprise deal that slipped in August. It goes live in December.

Net burn fell to $112k, giving us roughly 17 months of runway.

We're starting Series A prep for Q2 next year and would love feedback on the narrative.

— Priya`,
  },
];

const investors = [
  { name: "Maya Lindqvist", email: "maya@northstar-ventures.test", firm: "Northstar Ventures" },
  { name: "Daniel Okafor", email: "daniel@bluepeak.test", firm: "Bluepeak Capital" },
  { name: "Sofia Marin", email: "sofia.marin@angel.test", firm: "Angel investor" },
];

export async function seedIfEmpty() {
  const c = await one("SELECT id FROM companies LIMIT 1");
  if (c) return false;
  await seed();
  return true;
}

export async function seed() {
  await q("TRUNCATE companies, users, updates, recipients, views, email_log RESTART IDENTITY CASCADE");
  const secret = crypto.randomBytes(24).toString("base64url");
  const company = (await one(
    "INSERT INTO companies (name, slug, founder_name, founder_email, mcp_secret, created_at) VALUES ($1,$2,$3,$4,$5,'2026-05-20') RETURNING *",
    ["Acme Payments", "acme-payments", "Priya Raman", null, secret],
  ))!;
  await q("INSERT INTO users (company_id, username, password_hash) VALUES ($1,$2,$3)", [
    company.id, DEMO_USERNAME, hashPassword(DEMO_PASSWORD),
  ]);
  const recips = [];
  for (const i of investors) {
    recips.push((await one(
      "INSERT INTO recipients (company_id, name, email, firm, token, created_at) VALUES ($1,$2,$3,$4,$5,'2026-05-25') RETURNING *",
      [company.id, i.name, i.email, i.firm, newToken()],
    ))!);
  }
  for (const [idx, m] of months.entries()) {
    const [y, mo] = m.period.split("-").map(Number);
    const publishedAt = new Date(Date.UTC(y, mo, 4, 15, 0)); // 4th of the following month
    const u = (await one(
      `INSERT INTO updates (company_id, period, status, metrics, highlights, lowlights, asks, body_markdown, created_via, published_at, created_at, updated_at)
       VALUES ($1,$2,'published',$3,$4,$5,$6,$7,$8,$9,$9,$9) RETURNING *`,
      [company.id, m.period, JSON.stringify(m.metrics), JSON.stringify(m.highlights), JSON.stringify(m.lowlights),
        JSON.stringify(m.asks), m.body, idx < 2 ? "app" : "claude", publishedAt],
    ))!;
    // Realistic open history: most investors read most updates.
    for (const [ri, r] of recips.entries()) {
      if ((idx + ri) % 4 === 3) continue;
      const at = new Date(publishedAt.getTime() + (ri + 1) * 3.5 * 3600_000);
      await q("INSERT INTO views (update_id, recipient_id, viewed_at) VALUES ($1,$2,$3)", [u.id, r.id, at]);
    }
  }
  return company;
}
