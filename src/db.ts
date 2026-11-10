import pg from "pg";

const url = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/postgres";

function needsSsl(u: string): boolean {
  if (/sslmode=disable/.test(u)) return false;
  if (/sslmode=require/.test(u)) return true;
  try {
    const host = new URL(u).hostname;
    // Private-network hosts (Render "dpg-xxx", Railway "*.railway.internal") need no SSL; public hosts do.
    if (host.endsWith(".internal")) return false;
    return host.includes(".") && host !== "127.0.0.1" && host !== "localhost";
  } catch {
    return false;
  }
}

export const pool = new pg.Pool({
  connectionString: url,
  ssl: needsSsl(url) ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX || 5),
});

// Postgres NUMERIC comes back as string; we store metrics in JSONB so this is mostly moot.
export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const r = await pool.query(text, params);
  return r.rows as T[];
}

export async function one<T = any>(text: string, params: any[] = []): Promise<T | undefined> {
  const rows = await q<T>(text, params);
  return rows[0];
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  founder_name TEXT NOT NULL,
  founder_email TEXT,
  mcp_secret TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS updates (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  lowlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  asks JSONB NOT NULL DEFAULT '[]'::jsonb,
  body_markdown TEXT NOT NULL DEFAULT '',
  created_via TEXT NOT NULL DEFAULT 'app' CHECK (created_via IN ('claude','app')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, period)
);
CREATE TABLE IF NOT EXISTS recipients (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  firm TEXT,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, email)
);
CREATE TABLE IF NOT EXISTS views (
  id SERIAL PRIMARY KEY,
  update_id INT NOT NULL REFERENCES updates(id) ON DELETE CASCADE,
  recipient_id INT NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS views_update_idx ON views(update_id);
CREATE INDEX IF NOT EXISTS views_recipient_idx ON views(recipient_id);
CREATE TABLE IF NOT EXISTS email_log (
  id SERIAL PRIMARY KEY,
  company_id INT REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref TEXT,
  to_email TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  detail TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function migrate() {
  await pool.query(SCHEMA);
}

export type Metrics = {
  mrr?: number | null;
  revenue?: number | null;
  cash?: number | null;
  net_burn?: number | null;
  headcount?: number | null;
  custom?: Record<string, number | string>;
};

export type Company = {
  id: number; name: string; slug: string; founder_name: string; founder_email: string | null;
  mcp_secret: string; created_at: Date;
};

export type Update = {
  id: number; company_id: number; period: string; status: "draft" | "published";
  metrics: Metrics; highlights: string[]; lowlights: string[]; asks: string[];
  body_markdown: string; created_via: "claude" | "app"; published_at: Date | null;
  created_at: Date; updated_at: Date;
};

export type Recipient = {
  id: number; company_id: number; name: string; email: string; firm: string | null; token: string; created_at: Date;
};
