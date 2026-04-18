import { RequestHandler } from "express";
import jwt from "jsonwebtoken";

export type AuthMode = "disabled" | "legacy_jwt" | "clerk";
export type AuthProvider = "legacy_jwt" | "clerk";

export interface AuthPrincipal {
  provider: AuthProvider;
  subject: string;
  email: string | null;
}

interface LegacyUserPayload {
  id: string;
  iat: number;
  exp: number;
}

interface ClerkJwtPayload {
  sub?: string;
  email?: string;
  email_address?: string;
  primary_email_address?: string;
  iat?: number;
  exp?: number;
  nbf?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: LegacyUserPayload;
    }
  }
}

const DEV_USER: LegacyUserPayload = { id: "dev", iat: 0, exp: 0 };

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return fallback;
}

function getLegacySecret(): string | null {
  return process.env.JWT_SECRET?.trim() || null;
}

function normalizePem(raw: string): string {
  return raw.replace(/\\n/g, "\n").trim();
}

function getClerkJwtKey(): string | null {
  const raw = process.env.CLERK_JWT_KEY?.trim();
  if (!raw) return null;
  return normalizePem(raw);
}

export function getAuthMode(): AuthMode {
  const raw = process.env.REMI_AUTH_MODE?.trim().toLowerCase();
  if (raw === "disabled") return "disabled";
  if (raw === "legacy_jwt") return "legacy_jwt";
  if (raw === "clerk") return "clerk";
  return getLegacySecret() ? "legacy_jwt" : "disabled";
}

export function allowLoopbackAuthBypass(): boolean {
  return parseBooleanFlag(
    process.env.REMI_AUTH_ALLOW_LOOPBACK_BYPASS,
    process.env.NODE_ENV !== "production",
  );
}

function verifyClerkToken(token: string): AuthPrincipal | null {
  const jwtKey = getClerkJwtKey();
  if (!jwtKey) return null;
  try {
    const payload = jwt.verify(token, jwtKey, {
      algorithms: ["RS256"],
    }) as ClerkJwtPayload;
    const subject = payload.sub?.trim();
    if (!subject) return null;
    return {
      provider: "clerk",
      subject,
      email:
        payload.email?.trim() ||
        payload.email_address?.trim() ||
        payload.primary_email_address?.trim() ||
        null,
    };
  } catch {
    return null;
  }
}

function verifyLegacyJwtToken(token: string): AuthPrincipal | null {
  const secret = getLegacySecret();
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret) as LegacyUserPayload;
    const subject = payload.id?.trim();
    if (!subject) return null;
    return {
      provider: "legacy_jwt",
      subject,
      email: null,
    };
  } catch {
    return null;
  }
}

export function authMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (getAuthMode() === "disabled") {
      req.user = DEV_USER;
      return next();
    }

    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing token" });
      return;
    }

    const token = header.slice(7);
    const principal = verifyToken(token);
    if (principal) {
      req.user = { id: principal.subject, iat: 0, exp: 0 };
      next();
      return;
    }

    res.status(401).json({ error: "Invalid or expired token" });
  };
}

export function generateToken(userId: string): string {
  const secret = getLegacySecret();
  if (!secret) throw new Error("JWT_SECRET not configured");
  return jwt.sign({ id: userId }, secret, { expiresIn: "24h" });
}

export function verifyToken(token: string): AuthPrincipal | null {
  const mode = getAuthMode();
  if (mode === "clerk") {
    return verifyClerkToken(token) ?? verifyLegacyJwtToken(token);
  }
  return verifyLegacyJwtToken(token);
}

export function wsAuthenticateOnce(token: string): { id: string } | null {
  if (getAuthMode() === "disabled") return { id: "dev" };
  const principal = verifyToken(token);
  if (!principal) return null;
  return { id: principal.subject };
}
