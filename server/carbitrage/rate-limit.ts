import type { IncomingMessage } from "node:http";
import { ServiceError } from "./domain.ts";

/**
 * Limits for the routes a reverse proxy does not limit. Each window is counted
 * twice: once for the client IP, and once for the account (email or user id)
 * when we know it. A request is refused when either count is over.
 *
 * The connecting socket is used as the IP. When that socket is a private proxy
 * (the Hostinger proxy on this machine), the client IP is the first address in
 * X-Forwarded-For, so the proxy must set that header itself and not keep a
 * value the browser sent. A direct loopback call with no forwarded address
 * (the test suite) is not counted.
 *
 *   sign-in   POST /auth/v1/token, POST /api/carbitrage/session, POST /api/carbitrage/session/demo
 *             80 per IP and 15 per account, every 15 minutes
 *   sign-out  POST /auth/v1/logout, DELETE /api/carbitrage/session
 *             60 per IP and 30 per account, every 15 minutes
 *   guide     POST /api/wholesale/guide
 *             20 per IP and 20 per account, every 10 minutes
 *   send      POST /api/wholesale/send
 *             15 per IP and 15 per account, every hour
 *   price     POST /api/wholesale/buyer/price
 *             40 per IP and 40 per account, every 10 minutes
 */

export type RateRuleId = "sign-in" | "sign-out" | "guide" | "send" | "price";

export interface RateRule {
  id: RateRuleId;
  limitIp: number;
  limitAccount: number;
  windowMs: number;
  message: string;
}

const MINUTE = 60_000;

export const RATE_RULES: readonly RateRule[] = [
  {
    id: "sign-in",
    limitIp: 80,
    limitAccount: 15,
    windowMs: 15 * MINUTE,
    message: "Too many sign-in tries. Wait 15 minutes and try again.",
  },
  {
    id: "sign-out",
    limitIp: 60,
    limitAccount: 30,
    windowMs: 15 * MINUTE,
    message: "Too many sign-out tries. Wait 15 minutes and try again.",
  },
  {
    id: "guide",
    limitIp: 20,
    limitAccount: 20,
    windowMs: 10 * MINUTE,
    message: "Too many guide lookups. Wait 10 minutes and try again.",
  },
  {
    id: "send",
    limitIp: 15,
    limitAccount: 15,
    windowMs: 60 * MINUTE,
    message: "Too many cars sent. Wait an hour and try again.",
  },
  {
    id: "price",
    limitIp: 40,
    limitAccount: 40,
    windowMs: 10 * MINUTE,
    message: "Too many price updates. Wait 10 minutes and try again.",
  },
];

export function matchRateRule(method: string, path: string, rules: readonly RateRule[] = RATE_RULES): RateRule | null {
  const verb = method.toUpperCase();
  switch (verb) {
    case "POST":
      if (path === "/auth/v1/token" || path === "/api/carbitrage/session" || path === "/api/carbitrage/session/demo") return find(rules, "sign-in");
      if (path === "/auth/v1/logout") return find(rules, "sign-out");
      if (path === "/api/wholesale/guide") return find(rules, "guide");
      if (path === "/api/wholesale/send") return find(rules, "send");
      if (path === "/api/wholesale/buyer/price") return find(rules, "price");
      return null;
    case "DELETE":
      if (path === "/api/carbitrage/session") return find(rules, "sign-out");
      return null;
    case "GET":
    case "PUT":
    case "PATCH":
    case "HEAD":
    case "OPTIONS":
      return null;
    default:
      return null;
  }
}

function find(rules: readonly RateRule[], id: RateRuleId): RateRule | null {
  return rules.find((rule) => rule.id === id) ?? null;
}

interface Bucket { start: number; count: number }

export interface RateLimitScope {
  /** Count the IP bucket. Default true. */
  ip?: boolean;
  /** Count the account bucket. Default true. */
  account?: boolean;
}

export interface RateLimiter {
  consume(rule: RateRule, ip: string | null, account: string | null, now: number, scope?: RateLimitScope): void;
}

export function createRateLimiter(): RateLimiter {
  const buckets = new Map<string, Bucket>();
  function take(key: string, limit: number, windowMs: number, now: number): boolean {
    const current = buckets.get(key);
    if (!current || now - current.start >= windowMs) {
      buckets.set(key, { start: now, count: 1 });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }
  return {
    consume(rule, ip, account, now, scope) {
      if (buckets.size > 20_000) {
        for (const [key, bucket] of buckets) {
          if (now - bucket.start >= rule.windowMs) buckets.delete(key);
        }
      }
      const countIp = scope?.ip !== false;
      const countAccount = scope?.account !== false;
      const ipOver = countIp && ip != null && !take(`ip:${rule.id}:${ip}`, rule.limitIp, rule.windowMs, now);
      const accountKey = account?.trim().toLowerCase() ?? "";
      const accountOver = countAccount && accountKey.length > 0 && !take(`acct:${rule.id}:${accountKey}`, rule.limitAccount, rule.windowMs, now);
      if (ipOver || accountOver) throw new ServiceError(429, "rate_limited", rule.message);
    },
  };
}

function normalizeIp(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/^::ffff:/i, "");
}

function isPrivate(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip)) return true;
  const second = Number(ip.split(".")[1]);
  if (/^172\./.test(ip) && second >= 16 && second <= 31) return true;
  if (/^(fc|fd|fe80:)/i.test(ip)) return true;
  return false;
}

function forwardedClient(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header.join(",") : header;
  const first = raw?.split(",")[0]?.trim().replace(/^::ffff:/i, "") ?? "";
  if (!first || first.length > 64 || /\s/.test(first)) return null;
  return first;
}

/**
 * Null when this is a direct loopback call with no proxy header, so local tests
 * are not counted. A private peer with X-Forwarded-For is the reverse proxy.
 */
export function clientIp(peer: string | undefined, forwarded: string | string[] | undefined): string | null {
  const socket = normalizeIp(peer);
  if (!socket) return "unknown";
  if (isPrivate(socket)) return forwardedClient(forwarded);
  return socket;
}

export function requestIp(req: IncomingMessage): string | null {
  return clientIp(req.socket.remoteAddress, req.headers["x-forwarded-for"]);
}
