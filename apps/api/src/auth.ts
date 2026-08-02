import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

const cookieName = "warden_session";

function sign(value: string): string {
  return createHmac("sha256", config.sessionSecret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueSession(res: Response): { userId: string; csrfToken: string } {
  const payload = `user_demo.${Date.now()}`;
  const value = `${payload}.${sign(payload)}`;
  res.cookie(cookieName, value, {
    httpOnly: true,
    secure: config.production,
    sameSite: "strict",
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  });
  return { userId: "user_demo", csrfToken: sign(`${value}.csrf`) };
}

export function readSession(req: Request): { userId: string; csrfToken: string } | null {
  const value = req.cookies?.[cookieName] as string | undefined;
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  if (!parts[2] || !safeEqual(parts[2], sign(payload))) return null;
  const issuedAt = Number(parts[1]);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 12 * 60 * 60 * 1000) return null;
  return { userId: String(parts[0]), csrfToken: sign(`${value}.csrf`) };
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      csrfToken?: string;
    }
  }
}

export function requireSession(req: Request, res: Response, next: NextFunction) {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Start a WARDEN session first." } });
    return;
  }
  req.userId = session.userId;
  req.csrfToken = session.csrfToken;
  next();
}

export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const supplied = req.header("x-csrf-token");
  if (!supplied || !req.csrfToken || !safeEqual(supplied, req.csrfToken)) {
    res.status(403).json({ error: { code: "CSRF_INVALID", message: "The request token is missing or invalid." } });
    return;
  }
  next();
}
