import { createSign, generateKeyPairSync, randomBytes, randomUUID, scryptSync, timingSafeEqual, type KeyObject } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import pg from "pg";

/**
 * PRIVATE PREVIEW ONLY. A small stand-in for the Supabase sign-in server (GoTrue) so the franchise sign-in can be tested end to end
 * on test accounts, without touching the real Ooglecars accounts.
 *
 * It speaks just enough of the Supabase auth API for supabase-js (password sign-in, refresh, user, sign-out) and publishes its
 * public key at /auth/v1/.well-known/jwks.json. Tokens are ES256, exactly the kind the Ooglecars project issues, and the server
 * checks them with the same verifier it uses in production (createJwksVerifier). Only the key source differs.
 * It refuses to run outside preview and only knows the rows in preview_test_accounts.
 */

export const TEST_AUTH_ISSUER = "https://carbitrage-test-auth.invalid/auth/v1";
const ACCESS_TTL_S = 60 * 60;

export interface TestAuth {
  handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>;
  jwks(): { keys: Array<Record<string, unknown>> };
  /** Same thing a browser would fetch, for the in-process verifier. */
  fetchJwks: typeof fetch;
  /** Test helper: a token signed by this issuer. */
  sign(claims: { sub: string; email?: string; expiresInS?: number; issuer?: string; audience?: string }): string;
  revokedSessions: Set<string>;
}

function hashFor(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString("hex");
}

/** Writes (or refreshes) the test accounts' password hashes from the private password file. Never logs the password. */
export async function seedTestAccountPasswords(pool: pg.Pool, password: string): Promise<number> {
  const rows = await pool.query<{ user_id: string }>("select user_id from preview_test_accounts");
  for (const r of rows.rows) {
    const salt = randomBytes(16).toString("hex");
    await pool.query("update preview_test_accounts set password_salt = $2, password_hash = $3 where user_id = $1", [r.user_id, salt, hashFor(password, salt)]);
  }
  return rows.rowCount ?? 0;
}

export function createTestAuth(opts: { pool: pg.Pool; preview: boolean; now?: () => Date }): TestAuth {
  if (!opts.preview) throw new Error("The test sign-in server only runs in the private preview");
  const now = opts.now ?? (() => new Date());
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = `test-${randomBytes(6).toString("hex")}`;
  const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid, alg: "ES256", use: "sig" };
  const refresh = new Map<string, { userId: string; sessionId: string }>();
  const revokedSessions = new Set<string>();

  function sign(c: { sub: string; email?: string; expiresInS?: number; issuer?: string; audience?: string; sessionId?: string }, key: KeyObject = privateKey): string {
    const iat = Math.floor(now().getTime() / 1000);
    const header = { alg: "ES256", kid, typ: "JWT" };
    const payload = { iss: c.issuer ?? TEST_AUTH_ISSUER, aud: c.audience ?? "authenticated", sub: c.sub, role: "authenticated", email: c.email, iat, exp: iat + (c.expiresInS ?? ACCESS_TTL_S), session_id: c.sessionId ?? randomUUID() };
    const body = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    const signer = createSign("sha256");
    signer.update(body);
    return `${body}.${signer.sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  }

  function session(userId: string, email: string, sessionId: string = randomUUID()) {
    const access = sign({ sub: userId, email, sessionId });
    const refreshToken = randomBytes(18).toString("base64url");
    refresh.set(refreshToken, { userId, sessionId });
    const iat = Math.floor(now().getTime() / 1000);
    return {
      access_token: access, token_type: "bearer", expires_in: ACCESS_TTL_S, expires_at: iat + ACCESS_TTL_S, refresh_token: refreshToken,
      user: { id: userId, aud: "authenticated", role: "authenticated", email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-11-20T00:00:00Z" },
    };
  }

  function reply(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(status === 204 ? undefined : JSON.stringify(body));
  }

  async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) { const b = Buffer.isBuffer(c) ? c : Buffer.from(c); size += b.length; if (size > 16_384) break; chunks.push(b); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; } catch { return {}; }
  }

  const jwks = () => ({ keys: [jwk] });
  const fetchJwks = (async () => new Response(JSON.stringify(jwks()), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

  return {
    jwks, fetchJwks, revokedSessions,
    sign: (c) => sign(c),
    async handle(req, res, url) {
      const path = url.pathname;
      if (!path.startsWith("/auth/v1/")) return false;
      if (req.method === "GET" && path === "/auth/v1/.well-known/jwks.json") { reply(res, 200, jwks()); return true; }
      if (req.method === "POST" && path === "/auth/v1/token") {
        const grant = url.searchParams.get("grant_type");
        const body = await readBody(req);
        if (grant === "password") {
          const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
          const password = typeof body.password === "string" ? body.password : "";
          const r = await opts.pool.query<{ user_id: string; email: string; password_salt: string | null; password_hash: string | null }>(
            "select user_id, email, password_salt, password_hash from preview_test_accounts where lower(email) = $1", [email]);
          const acct = r.rows[0];
          // Same answer for an unknown email and a wrong password.
          let good = false;
          if (acct?.password_salt && acct.password_hash) {
            const a = Buffer.from(hashFor(password, acct.password_salt), "hex");
            const b = Buffer.from(acct.password_hash, "hex");
            good = a.length === b.length && timingSafeEqual(a, b);
          }
          if (!acct || !good) { reply(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }); return true; }
          reply(res, 200, session(acct.user_id, acct.email));
          return true;
        }
        if (grant === "refresh_token") {
          const token = typeof body.refresh_token === "string" ? body.refresh_token : "";
          const known = refresh.get(token);
          if (!known || revokedSessions.has(known.sessionId)) { reply(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }); return true; }
          refresh.delete(token);
          const a = await opts.pool.query<{ email: string }>("select email from preview_test_accounts where user_id = $1", [known.userId]);
          reply(res, 200, session(known.userId, a.rows[0]?.email ?? "", known.sessionId));
          return true;
        }
        reply(res, 400, { code: 400, error_code: "validation_failed", msg: "Unsupported grant_type" });
        return true;
      }
      if (req.method === "POST" && path === "/auth/v1/logout") {
        const auth = req.headers.authorization?.replace(/^bearer\s+/i, "");
        try {
          const claims = auth ? JSON.parse(Buffer.from(auth.split(".")[1] ?? "", "base64url").toString("utf8")) as { session_id?: string } : {};
          if (claims.session_id) revokedSessions.add(claims.session_id);
        } catch { /* nothing to revoke */ }
        reply(res, 204, null);
        return true;
      }
      if (req.method === "GET" && path === "/auth/v1/user") {
        const auth = req.headers.authorization?.replace(/^bearer\s+/i, "") ?? "";
        try {
          const c = JSON.parse(Buffer.from(auth.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; email?: string; session_id?: string };
          if (!c.sub || (c.session_id && revokedSessions.has(c.session_id))) throw new Error("no");
          reply(res, 200, { id: c.sub, aud: "authenticated", role: "authenticated", email: c.email, app_metadata: {}, user_metadata: {} });
        } catch { reply(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" }); }
        return true;
      }
      reply(res, 404, { code: 404, msg: "not found" });
      return true;
    },
  };
}
