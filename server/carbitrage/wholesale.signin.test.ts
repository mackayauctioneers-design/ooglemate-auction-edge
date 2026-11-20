import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import pg from "pg";
import { createJwksVerifier } from "./auth.ts";
import { startCarbitrageServer } from "./http.ts";
import { applyWholesaleMirror } from "./pg-port.ts";
import { createTestAuth, seedTestAccountPasswords, TEST_AUTH_ISSUER } from "./test-auth.ts";
import { createWholesale } from "./wholesale.ts";

/**
 * Real sign-in and buyer alerts, over real HTTP, on a throwaway local database and the test sign-in server.
 * Covers: role resolved on the server, wrong-role refusal, each buyer sees only their own prices, no dealer identity in any buyer
 * payload or alert, sign-out ends the session, token forgery/expiry refused, alerts gated by the OFF switch, all-four default and
 * picked-buyers-only. Skipped when the box's local Postgres is not reachable.
 */

const U = {
  dealer: "00000000-0000-4000-8000-0000000d0001",
  macka: "00000000-0000-4000-8000-0000000b0a01", alex: "00000000-0000-4000-8000-0000000b0a02",
  griefy: "00000000-0000-4000-8000-0000000b0a03", cam: "00000000-0000-4000-8000-0000000b0a04",
  nobody: "00000000-0000-4000-8000-0000000c0001", yard: "00000000-0000-4000-8000-0000000c0002",
};
const EMAIL: Record<string, string> = {
  dealer: "patrick@test.carbitrage.invalid", macka: "macka@buyer.example.invalid", alex: "alex@buyer.example.invalid",
  griefy: "griefy@buyer.example.invalid", cam: "cam@buyer.example.invalid", nobody: "nobody@test.carbitrage.invalid", yard: "yard@test.carbitrage.invalid",
};
const BUYER_ID = (n: number) => `00000000-0000-4000-8000-00000000b00${n}`;
const PASSWORD = `pw-${randomBytes(9).toString("hex")}`; // random per run, never printed

let base: string | null = null;
try { base = readFileSync(".carbitrage-local/migrate-url", "utf8").trim(); } catch { base = null; }
const dbName = `wholesale_si_${process.pid}_${randomBytes(3).toString("hex")}`;
let admin: pg.Client;
let pool: pg.Pool;
let server: { url: string; close: () => Promise<void> };
let ok = false;
let auth: ReturnType<typeof createTestAuth>;

before(async () => {
  if (!base) return;
  admin = new pg.Client({ connectionString: base });
  try { await admin.connect(); } catch { return; }
  await admin.query(`create database ${dbName}`);
  const u = new URL(base); u.pathname = `/${dbName}`;
  await applyWholesaleMirror(u.toString());
  pool = new pg.Pool({ connectionString: u.toString(), max: 4 });
  auth = createTestAuth({ pool, preview: true });
  await seedTestAccountPasswords(pool, PASSWORD);
  const verifier = createJwksVerifier({ jwksUrl: "http://test-auth.invalid/jwks", issuer: TEST_AUTH_ISSUER, fetchImpl: auth.fetchJwks });
  const wholesale = createWholesale({ pool, market: null, now: () => new Date(), preview: true, picker: false, alertBaseUrl: "https://test.example.invalid" });
  server = await startCarbitrageServer({
    data: {} as never, directory: {} as never, sessionSecret: "test-session-secret-test-session-secret", demoMode: true, jwtSecret: null,
    jwtVerifier: verifier, authNow: () => new Date(), testAuth: auth, wholesalePicker: false, oauthIssuer: null, oauthResourceUrl: null,
    persistence: "memory", now: () => new Date("2026-11-01T00:00:00Z"), wholesale, wholesaleUser: async (id) => id,
  }, 0);
  ok = true;
});

after(async () => {
  if (server) await server.close();
  if (pool) await pool.end();
  if (admin && ok) await admin.query(`drop database if exists ${dbName} with (force)`);
  if (admin) await admin.end().catch(() => undefined);
});

const q = (sql: string, args: unknown[] = []) => pool.query(sql, args);

interface Session { cookie: string; access: string; refresh: string }
async function signIn(who: string, password = PASSWORD): Promise<Session | null> {
  const r = await fetch(`${server.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL[who], password }) });
  if (r.status !== 200) return null;
  const t = await r.json() as { access_token: string; refresh_token: string };
  const x = await fetch(`${server.url}/api/carbitrage/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken: t.access_token }) });
  if (x.status !== 200) return null;
  return { cookie: (x.headers.get("set-cookie") ?? "").split(";")[0], access: t.access_token, refresh: t.refresh_token };
}
async function api(s: Session | null, method: string, path: string, body?: unknown) {
  const r = await fetch(`${server.url}/api/wholesale${path}`, { method, headers: { ...(s ? { cookie: s.cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, any> };
}

test("sign-in: right password works, wrong password and unknown email look the same", { skip: !base }, async (t) => {
  if (!ok) return t.skip();
  assert.ok(await signIn("dealer"));
  assert.equal(await signIn("dealer", "wrong-password-123"), null);
  const r = await fetch(`${server.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ghost@x.invalid", password: PASSWORD }) });
  assert.equal(r.status, 400);
  assert.equal((await r.json() as { msg: string }).msg, "Invalid login credentials");
});

test("role is resolved on the server: dealer, four buyers, no role, ordinary yard staff", { skip: !base }, async (t) => {
  if (!ok) return t.skip();
  const d = await api(await signIn("dealer"), "GET", "/me");
  assert.ok(d.body.dealer && !d.body.buyer);
  for (const [who, name] of [["macka", "Macka"], ["alex", "Alex"], ["griefy", "Griefy"], ["cam", "Cam"]] as const) {
    const b = await api(await signIn(who), "GET", "/me");
    assert.ok(b.body.buyer && !b.body.dealer, who);
    assert.equal(b.body.buyer.name, name);
  }
  // no role, and a yard that has wholesale_pricing but not the franchise feature: neither dealer nor buyer
  for (const who of ["nobody", "yard"] as const) {
    const n = await api(await signIn(who), "GET", "/me");
    assert.deepEqual([n.body.dealer, n.body.buyer], [null, null], who);
  }
  assert.equal((await api(null, "GET", "/me")).status, 401);
});

test("wrong-role refusal both ways, and for accounts with no role", { skip: !base }, async (t) => {
  if (!ok) return t.skip();
  const dealer = await signIn("dealer"), buyer = await signIn("alex"), nobody = await signIn("nobody"), yard = await signIn("yard");
  assert.equal((await api(buyer, "GET", "/info")).status, 403);
  assert.equal((await api(buyer, "GET", "/buyers")).status, 403);
  assert.equal((await api(buyer, "GET", "/requests")).status, 403);
  assert.equal((await api(buyer, "POST", "/send", { rego: "TEST02", km: 58400, buyerIds: "all" })).status, 403);
  assert.equal((await api(dealer, "GET", "/buyer/cars")).status, 403);
  assert.equal((await api(dealer, "POST", "/buyer/price", { code: "WT-AAAAAA", amountDollars: 1000 })).status, 403);
  for (const s of [nobody, yard]) {
    assert.equal((await api(s, "GET", "/info")).status, 403);
    assert.equal((await api(s, "GET", "/buyer/cars")).status, 403);
  }
  // the preview picker is gone: `as` cannot make a dealer into a buyer, and no sign-in means no buyer screens
  assert.equal((await api(dealer, "GET", `/buyer/cars?as=${BUYER_ID(1)}`)).status, 403);
  assert.equal((await api(null, "GET", `/buyer/cars?as=${BUYER_ID(1)}`)).status, 401);
  assert.equal((await api(dealer, "GET", "/buyer/list")).status, 404);
});

test("a forged, tampered, expired, wrong-issuer or wrong-audience token is refused; the old demo sign-in is off", { skip: !base }, async (t) => {
  if (!ok) return t.skip();
  const exchange = async (accessToken: string) => (await fetch(`${server.url}/api/carbitrage/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken }) })).status;
  assert.equal(await exchange(auth.sign({ sub: U.dealer, expiresInS: 600 })), 200);
  assert.equal(await exchange(auth.sign({ sub: U.dealer, expiresInS: -10 })), 401);
  assert.equal(await exchange(auth.sign({ sub: U.dealer, issuer: "https://evil.invalid/auth/v1" })), 401);
  assert.equal(await exchange(auth.sign({ sub: U.dealer, audience: "anon" })), 401);
  const good = auth.sign({ sub: U.dealer });
  const [h, p, s] = good.split(".");
  const tampered = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: U.macka })).toString("base64url")}.${s}`;
  assert.equal(await exchange(tampered), 401);
  // a user id sent in the body is refused outright
  const r = await fetch(`${server.url}/api/carbitrage/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: U.dealer }) });
  assert.equal(r.status, 400);
  // persona sign-in is off when the real sign-in is on
  const demo = await fetch(`${server.url}/api/carbitrage/session/demo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona: "patrick" }) });
  assert.equal(demo.status, 404);
  const pw = await fetch(`${server.url}/api/carbitrage/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL.dealer, password: PASSWORD }) });
  assert.equal(pw.status, 404);
});

test("sign-out: the sign-in session ends, refresh fails, and the Carbitrage cookie is cleared", { skip: !base }, async (t) => {
  if (!ok) return t.skip();
  const s = (await signIn("macka"))!;
  assert.equal((await api(s, "GET", "/me")).status, 200);
  const out = await fetch(`${server.url}/auth/v1/logout?scope=global`, { method: "POST", headers: { authorization: `Bearer ${s.access}` } });
  assert.equal(out.status, 204);
  const user = await fetch(`${server.url}/auth/v1/user`, { headers: { authorization: `Bearer ${s.access}` } });
  assert.equal(user.status, 401);
  const refresh = await fetch(`${server.url}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh_token: s.refresh }) });
  assert.equal(refresh.status, 400);
  const clear = await fetch(`${server.url}/api/carbitrage/session`, { method: "DELETE", headers: { cookie: s.cookie } });
  assert.match(clear.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("alerts: OFF queues nothing; ON sends all four by default; picked buyers only; no dealer identity anywhere a buyer can see", { skip: !base }, async (t) => {
  if (!ok) return t.skip();
  const dealer = (await signIn("dealer"))!;
  const buyers = { macka: (await signIn("macka"))!, alex: (await signIn("alex"))!, griefy: (await signIn("griefy"))!, cam: (await signIn("cam"))! };
  const inbox = async (s: Session) => ((await api(s, "GET", "/buyer/alerts")).body.alerts ?? []) as Array<{ text: string; code: string }>;

  // 1. switch OFF (as shipped): a car goes out to buyers, but no alert is queued or shown to anyone
  assert.equal((await q("select enabled from carbitrage_switches where key = 'franchise_buyer_alerts'")).rows[0].enabled, false);
  const off = await api(dealer, "POST", "/send", { rego: "TEST02", km: 58400, buyerIds: "all", note: "Two keys" });
  assert.equal(off.status, 201);
  assert.equal(off.body.alertsQueued, false);
  assert.equal(off.body.testInboxAlerts, 0);
  assert.equal((await q("select count(*)::int n from wholesale_buyer_alerts")).rows[0].n, 0);
  for (const s of Object.values(buyers)) assert.equal((await inbox(s)).length, 0);
  // the car is still on each buyer's desk: alerts are the only thing the switch holds back
  assert.ok(((await api(buyers.alex, "GET", "/buyer/cars")).body.cars as unknown[]).length >= 1);

  // 2. switch ON in this test database only: default is all four buyers
  await q("update carbitrage_switches set enabled = true where key = 'franchise_buyer_alerts'");
  const all = await api(dealer, "POST", "/send", { rego: "TEST01", km: 88833, buyerIds: "all", note: "Service book" });
  assert.equal(all.body.testInboxAlerts, 4);
  for (const s of Object.values(buyers)) {
    const a = (await inbox(s)).filter((m) => m.code === all.body.code);
    assert.equal(a.length, 1);
    assert.match(a[0].text, /^New car to price from a franchise dealer \(NSW\): 2022 Porsche Macan S, 88,833 km\. Code WT-[A-Z0-9]{6}\. The Carbitrage guide is on your buyer desk\. Price it here: https:\/\/test\.example\.invalid\/portal\/buyer-view\?car=WT-[A-Z0-9]{6}$/);
  }

  // 3. picked buyers only
  const picked = await api(dealer, "POST", "/send", { rego: "TEST02", km: 58400, buyerIds: [BUYER_ID(2), BUYER_ID(4)], note: "" });
  assert.equal(picked.body.testInboxAlerts, 2);
  const has = async (s: Session) => (await inbox(s)).some((m) => m.code === picked.body.code);
  assert.deepEqual([await has(buyers.macka), await has(buyers.alex), await has(buyers.griefy), await has(buyers.cam)], [false, true, false, true]);
  // a buyer who was not picked cannot see or price that car either
  const mackaCars = (await api(buyers.macka, "GET", "/buyer/cars")).body.cars as Array<{ code: string }>;
  assert.ok(!mackaCars.some((c) => c.code === picked.body.code));
  assert.equal((await api(buyers.macka, "POST", "/buyer/price", { code: picked.body.code, amountDollars: 30000 })).status, 404);

  // 4. a buyer sees only their own price, and nothing identifies the dealer in any buyer payload or alert
  assert.equal((await api(buyers.alex, "POST", "/buyer/price", { code: all.body.code, amountDollars: 51000 })).status, 201);
  assert.equal((await api(buyers.cam, "POST", "/buyer/price", { code: all.body.code, amountDollars: 53500 })).status, 201);
  const mine = async (s: Session) => ((await api(s, "GET", "/buyer/cars")).body.cars as Array<{ code: string; myPriceCents: number | null }>).find((c) => c.code === all.body.code)!.myPriceCents;
  assert.equal(await mine(buyers.alex), 5_100_000);
  assert.equal(await mine(buyers.cam), 5_350_000);
  assert.equal(await mine(buyers.macka), null);
  const everything = JSON.stringify([
    ...await Promise.all(Object.values(buyers).map(async (s) => (await api(s, "GET", "/buyer/cars")).body)),
    ...await Promise.all(Object.values(buyers).map(async (s) => (await api(s, "GET", "/buyer/history")).body)),
    ...await Promise.all(Object.values(buyers).map(async (s) => (await api(s, "GET", "/buyer/alerts")).body)),
  ]).toLowerCase();
  for (const needle of ["patrick", "preview test dealer", "dealer.example", "test@dealer", "0400 000 000", "example st", "fa01", "dealership", "d0001"]) assert.ok(!everything.includes(needle), `a buyer payload contained "${needle}"`);
  assert.match(everything, /franchise dealer, nsw/);
  const alexHist = JSON.stringify((await api(buyers.alex, "GET", "/buyer/history")).body);
  assert.ok(!alexHist.includes("5350000") && !alexHist.includes("53500"), "Alex saw Cam's price");

  // 5. dealer compares, picks, and the handover shows the buyer to the dealer
  const detail = (await api(dealer, "GET", `/requests/${all.body.code}`)).body as { prices: Array<{ bidId: string; name: string; amountCents: number }>; sentTo: unknown[] };
  assert.deepEqual(detail.prices.map((p) => p.name), ["Cam", "Alex"]);
  assert.equal(detail.sentTo.length, 4);
  assert.equal((await api(dealer, "POST", `/requests/${all.body.code}/pick`, { bidId: detail.prices[0].bidId })).status, 200);
  assert.equal((await api(buyers.alex, "POST", "/buyer/price", { code: all.body.code, amountDollars: 60000 })).status, 409);
  await q("update carbitrage_switches set enabled = false where key = 'franchise_buyer_alerts'");
});

test("the alert function returns nothing for a normal car, an unpicked buyer, or an unapproved buyer", { skip: !base }, async (t) => {
  if (!ok) return t.skip();
  const fn = async (buyer: string, tender: string) => (await q("select public.carbitrage_wholesale_alert_message_v1($1, $2) as r", [buyer, tender])).rows[0].r;
  await q(`insert into wholesale_tenders (dealership_id, public_code, status, year, make, model, badge, km, state, value_car_floor_cents)
           values ('00000000-0000-4000-8000-00000000fa02', 'WT-NORMAL', 'live', 2020, 'X', 'Y', 'Z', 1000, 'NSW', 1000000)`);
  const normal = (await q("select id from wholesale_tenders where public_code = 'WT-NORMAL'")).rows[0].id;
  assert.equal(await fn(BUYER_ID(1), normal), null);
  const targeted = (await q("select id from wholesale_tenders where target_buyer_ids is not null limit 1")).rows[0].id;
  assert.equal(await fn(BUYER_ID(1), targeted), null);
  assert.ok(await fn(BUYER_ID(2), targeted));
  await q("update wholesale_buyers set status = 'pending' where id = $1", [BUYER_ID(2)]);
  assert.equal(await fn(BUYER_ID(2), targeted), null);
  await q("update wholesale_buyers set status = 'approved' where id = $1", [BUYER_ID(2)]);
  // service role only
  const perms = await q("select has_function_privilege('anon', 'public.carbitrage_wholesale_alert_message_v1(uuid,uuid,text)', 'execute') a, has_function_privilege('authenticated', 'public.carbitrage_wholesale_alert_message_v1(uuid,uuid,text)', 'execute') b, has_function_privilege('service_role', 'public.carbitrage_wholesale_alert_message_v1(uuid,uuid,text)', 'execute') c");
  assert.deepEqual(perms.rows[0], { a: false, b: false, c: true });
});
