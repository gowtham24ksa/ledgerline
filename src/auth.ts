import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const got = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, got);
}

export function requireLogin(req: Request, res: Response, next: NextFunction) {
  if ((req as any).session?.companyId) return next();
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}
