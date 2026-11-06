import { createHash, randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { ServiceError, type Snapshot, type Store, type UserAccount } from "./domain.ts";

const SCRYPT_KEYLEN = 32;

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): { hash: string; salt: string } {
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, user: UserAccount): boolean {
  const actual = Buffer.from(user.passwordHash, "hex");
  const expected = scryptSync(password, user.passwordSalt, SCRYPT_KEYLEN);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function mintToken(prefix: "cbk" | "cbi"): string {
  return `${prefix}_${randomBytes(32).toString("hex")}`;
}

export function tokenMatches(raw: string, hash: string): boolean {
  const actual = Buffer.from(sha256(raw), "hex");
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

interface SessionPayload {
  userId: string;
  exp: number;
}

export function signSession(userId: string, secret: string, now: Date, ttlMs = 12 * 60 * 60 * 1000): string {
  const payload: SessionPayload = { userId, exp: now.getTime() + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readSession(token: string, secret: string, now: Date): string | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.userId || typeof payload.exp !== "number") return null;
    if (payload.exp < now.getTime()) return null;
    return payload.userId;
  } catch {
    return null;
  }
}

export function findUserByEmail(snapshot: Snapshot, email: string): UserAccount | undefined {
  const needle = email.trim().toLowerCase();
  return snapshot.users.find((u) => u.email.toLowerCase() === needle);
}

export function authenticatePassword(store: Store, email: string, password: string): UserAccount {
  const snapshot = store.snapshot();
  const user = findUserByEmail(snapshot, email);
  if (!user || !verifyPassword(password, user)) {
    throw new ServiceError(401, "unauthenticated", "Email or password is incorrect");
  }
  return user;
}

export const SESSION_COOKIE = "cb_session";

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export interface RuntimeFlags {
  demoMode: boolean;
  preview: boolean;
  jwtSecret: string | null;
  oauthIssuer: string | null;
  oauthResourceUrl: string | null;
}

/**
 * Local demo requires CARBITRAGE_ENV=local.
 * Preview demo requires CARBITRAGE_ENV=preview and still has to pass the
 * production-config refusal plus the gate file before the process listens.
 */
export function resolveRuntimeFlags(env: Record<string, string | undefined>): RuntimeFlags {
  const preview = env.CARBITRAGE_ENV === "preview";
  const localDemo = env.CARBITRAGE_DEMO_MODE === "1" && env.CARBITRAGE_ENV === "local";
  const previewDemo = env.CARBITRAGE_DEMO_MODE === "1" && preview;
  return {
    demoMode: localDemo || previewDemo,
    preview,
    jwtSecret: env.SUPABASE_JWT_SECRET?.trim() || null,
    oauthIssuer: env.CARBITRAGE_OAUTH_ISSUER?.trim() || null,
    oauthResourceUrl: env.CARBITRAGE_OAUTH_RESOURCE_URL?.trim() || null,
  };
}

export interface JwtClaims {
  sub: string;
  exp?: number;
  email?: string;
}

/** HS256 check compatible with a Supabase project JWT secret. No token is logged. */
export function verifySupabaseJwt(token: string, secret: string, now: Date): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return null;
  let header: { alg?: string };
  try {
    header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as { alg?: string };
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;
  const expected = createHmac("sha256", secret).update(`${headerPart}.${payloadPart}`).digest();
  const actual = Buffer.from(signaturePart, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as JwtClaims;
    if (!claims.sub) return null;
    if (typeof claims.exp === "number" && claims.exp * 1000 <= now.getTime()) return null;
    return claims;
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}
