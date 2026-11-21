import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { signSession } from "./auth.ts";
import { DEMO_NOW } from "./domain.ts";
import { seedDemo } from "./fixtures.ts";
import { memoryDirectory, startCarbitrageServer, type ServerOptions } from "./http.ts";
import { RATE_RULES, clientIp } from "./rate-limit.ts";
import { MemoryStore, memoryPort } from "./store.ts";

const SECRET = "edge-test-session-secret";
const JWT = "edge-test-jwt-secret";

function hsJwt(sub: string, expSec: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub, exp: expSec })).toString("base64url");
  const sig = createHmac("sha256", JWT).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function tightRules() {
  return RATE_RULES.map((rule) => ({ ...rule, limitIp: 2, limitAccount: 2, windowMs: 60_000 }));
}

async function boot(now: () => Date, extra: Partial<ServerOptions> = {}) {
  const store = new MemoryStore();
  const secrets = seedDemo(store, "demo-only", DEMO_NOW);
  const seen: Array<string | null> = [];
  const server = await startCarbitrageServer({
    data: memoryPort(store),
    directory: memoryDirectory(store),
    sessionSecret: SECRET,
    demoMode: true,
    jwtSecret: JWT,
    oauthIssuer: null,
    oauthResourceUrl: null,
    persistence: "memory",
    now,
    rateRules: tightRules(),
    wholesale: {
      async handle(_side, user) {
        seen.push(user);
        return { status: 200, body: { user } };
      },
    } as ServerOptions["wholesale"],
    ...extra,
  });
  return { server, secrets, seen };
}

test("client IP comes from the proxy header only when the peer is the local proxy", () => {
  assert.equal(clientIp("127.0.0.1", undefined), null);
  assert.equal(clientIp("127.0.0.1", "203.0.113.8, 10.0.0.1"), "203.0.113.8");
  assert.equal(clientIp("203.0.113.9", "198.51.100.2"), "203.0.113.9");
});

test("sign-in, guide, send and price say no in plain words after the limit, then allow again", async () => {
  let nowMs = Date.parse("2026-11-21T00:00:00Z");
  const { server, secrets } = await boot(() => new Date(nowMs));
  const ip = { "x-forwarded-for": "203.0.113.10" };
  const email = secrets.users.patrick.email;
  try {
    const login = () => fetch(`${server.url}/api/carbitrage/session`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ip },
      body: JSON.stringify({ email, password: secrets.password }),
    });
    assert.equal((await login()).status, 200);
    assert.equal((await login()).status, 200);
    const blocked = await login();
    assert.equal(blocked.status, 429);
    assert.match(((await blocked.json()) as { message: string }).message, /Too many sign-in tries/);

    const cookie = `${signSession("user-a", SECRET, new Date(nowMs))}`;
    const post = (path: string, forwarded = "203.0.113.20", user = "user-a") => fetch(`${server.url}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": forwarded,
        cookie: `cb_session=${signSession(user, SECRET, new Date(nowMs))}`,
      },
      body: "{}",
    });
    assert.equal((await post("/api/wholesale/guide")).status, 200);
    assert.equal((await post("/api/wholesale/guide")).status, 200);
    const guide = await post("/api/wholesale/guide");
    assert.equal(guide.status, 429);
    assert.match(((await guide.json()) as { message: string }).message, /Too many guide lookups/);
    // Same account, another IP: the account limit still applies.
    const otherIp = await post("/api/wholesale/guide", "203.0.113.21");
    assert.equal(otherIp.status, 429);
    // Another account on a fresh IP is fine.
    assert.equal((await post("/api/wholesale/send", "203.0.113.30", "user-b")).status, 200);
    assert.equal((await post("/api/wholesale/send", "203.0.113.30", "user-b")).status, 200);
    const sent = await post("/api/wholesale/send", "203.0.113.30", "user-b");
    assert.equal(sent.status, 429);
    assert.match(((await sent.json()) as { message: string }).message, /Too many cars sent/);
    assert.equal((await post("/api/wholesale/buyer/price", "203.0.113.40", "user-c")).status, 200);
    assert.equal((await post("/api/wholesale/buyer/price", "203.0.113.40", "user-c")).status, 200);
    const price = await post("/api/wholesale/buyer/price", "203.0.113.40", "user-c");
    assert.equal(price.status, 429);
    assert.match(((await price.json()) as { message: string }).message, /Too many price updates/);

    nowMs += 60_000;
    assert.equal((await post("/api/wholesale/guide")).status, 200);
    void cookie;
  } finally {
    await server.close();
  }
});

test("carbitrage.com.au may call the API without cookies; another site may not", async () => {
  const { server } = await boot(() => DEMO_NOW);
  try {
    const health = await fetch(`${server.url}/api/carbitrage/health`, { headers: { origin: "https://carbitrage.com.au" } });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), "https://carbitrage.com.au");
    assert.equal(health.headers.get("access-control-allow-credentials"), null);
    const www = await fetch(`${server.url}/api/carbitrage/health`, { headers: { origin: "https://www.carbitrage.com.au" } });
    assert.equal(www.headers.get("access-control-allow-origin"), "https://www.carbitrage.com.au");
    const evil = await fetch(`${server.url}/api/carbitrage/health`, { headers: { origin: "https://evil.example" } });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);
    const preflight = await fetch(`${server.url}/api/wholesale/guide`, {
      method: "OPTIONS",
      headers: { origin: "https://carbitrage.com.au", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
    });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /authorization/i);
    assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
    const refused = await fetch(`${server.url}/api/wholesale/guide`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    assert.equal(refused.status, 403);
    assert.equal(refused.headers.get("access-control-allow-origin"), null);
  } finally {
    await server.close();
  }
});

test("a wholesale call with a Bearer token and no cookie is the signed-in user", async () => {
  const nowMs = Date.parse("2026-11-21T00:00:00Z");
  const { server, seen } = await boot(() => new Date(nowMs));
  try {
    const token = hsJwt("user-bearer", Math.floor(nowMs / 1000) + 3600);
    const res = await fetch(`${server.url}/api/wholesale/me`, {
      headers: { authorization: `Bearer ${token}`, origin: "https://www.carbitrage.com.au" },
    });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { user: string }).user, "user-bearer");
    assert.deepEqual(seen, ["user-bearer"]);
    assert.equal(res.headers.get("access-control-allow-credentials"), null);
    const cookie = await fetch(`${server.url}/api/wholesale/me`, { headers: { cookie: `cb_session=${signSession("user-cookie", SECRET, new Date(nowMs))}` } });
    assert.equal(cookie.status, 200);
    assert.equal(((await cookie.json()) as { user: string }).user, "user-cookie");
  } finally {
    await server.close();
  }
});
