import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, jwtVerify } from "jose";
import { handleDesk, type DeskStore, type Opp } from "../../supabase/functions/operator-desk/scope.ts";

const ISS = "https://esyinwxhcpexncgqcnwi.supabase.co/auth/v1";
const A = "d24da4ea-f500-47fd-9b66-d2c9aa2d3f51", B = "8140eae1-2c36-40b6-a358-4f5ed05bbbcf", C = "a2aec451-3b68-47f1-aaa8-ce7ef470b30d";
const DEALER_A = "11111111-1111-4111-8111-111111111111", OWNER = "22222222-2222-4222-8222-222222222222", BUYER = "33333333-3333-4333-8333-333333333333",
  UNLINKED = "44444444-4444-4444-8444-444444444444", STAFF_A = "55555555-5555-4555-8555-555555555555", ADMIN_A = "66666666-6666-4666-8666-666666666666";
const OPP_A = "aaaaaaaa-0000-4000-8000-000000000001", OPP_B = "bbbbbbbb-0000-4000-8000-000000000002", OPP_C = "cccccccc-0000-4000-8000-000000000003",
  OPP_NONE = "dddddddd-0000-4000-8000-000000000004", OPP_A_TAKEN_B = "eeeeeeee-0000-4000-8000-000000000005", OPP_B_GIVEN_A = "ffffffff-0000-4000-8000-000000000006";
const members: Record<string, { dealership_id: string; role: string }[]> = {
  [DEALER_A]: [{ dealership_id: "yard-a", role: "owner" }, { dealership_id: "yard-b", role: "staff" }],
  [UNLINKED]: [{ dealership_id: "yard-acm", role: "owner" }],
  [STAFF_A]: [{ dealership_id: "yard-a", role: "staff" }],
  [ADMIN_A]: [{ dealership_id: "yard-a", role: "admin" }],
  [BUYER]: [], [OWNER]: [],
};
const links: Record<string, string> = { "yard-a": A, "yard-b": B, "yard-c": C };

let key: CryptoKey, other: CryptoKey, verify: (t: string) => Promise<any>;
before(async () => {
  const kp = await generateKeyPair("ES256"); key = kp.privateKey as CryptoKey;
  other = (await generateKeyPair("ES256")).privateKey as CryptoKey;
  const set = createLocalJWKSet({ keys: [{ ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "ES256" }] });
  verify = (t) => jwtVerify(t, set, { issuer: ISS, audience: "authenticated", algorithms: ["ES256"] });
});
const sign = (sub: string, o: { key?: CryptoKey; exp?: string | number; iss?: string } = {}) =>
  new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: "k1" }).setSubject(sub).setIssuer(o.iss ?? ISS).setAudience("authenticated").setIssuedAt().setExpirationTime(o.exp ?? "1h").sign(o.key ?? key);

function deps() {
  const car = (id: string, best: string | null, assigned: string | null = null): Opp => ({ id, listing_id: `L-${id}`, best_account_id: best, assigned_to_account: assigned, best_account_name: best ? "Yard" : null, make: "Toyota", model: "Hilux", year: 2019, km: 90000, status: "new" });
  const opps: Opp[] = [
    { ...car(OPP_A, A), alt_matches: [{ account_id: A }, { account_id: B }] },
    car(OPP_B, B), car(OPP_C, C), car(OPP_NONE, null), car(OPP_A_TAKEN_B, A, B), car(OPP_B_GIVEN_A, B, A),
  ];
  const log: string[] = [];
  const mandates: any[] = [];
  const accounts = [{ id: A, display_name: "Mackay" }, { id: B, display_name: "AJH" }, { id: C, display_name: "Shed" }];
  const store: DeskStore = {
    isOwner: async (id) => id === OWNER,
    yardAccounts: async (ds) => ds.map((d) => links[d]).filter(Boolean),
    accounts: async (ids) => ids === null ? accounts : accounts.filter((a) => ids.includes(a.id)),
    listOpps: async () => ({ active: opps, starred: [] }), // unfiltered on purpose: the handler must still drop other yards
    getOpp: async (id) => opps.find((o) => o.id === id) ?? null,
    updateOpp: async (id) => { log.push(`update:${id}`); },
    hasStarHunt: async () => false,
    insertMandate: async (row) => { mandates.push(row); log.push("mandate"); },
    listFinds: async () => [{ id: "f1" }],
    updateFind: async () => { log.push("find"); return true; },
    invoke: async (fn, body) => { log.push(`${fn}:${JSON.stringify(body)}`); return {}; },
  };
  return { log, mandates, d: { verify, store, memberships: async (_t: string, sub: string) => members[sub] ?? [] } };
}
const status = async (p: Promise<unknown>) => { try { await p; return 200; } catch (e: any) { return e.status ?? 500; } };
const call = async (who: string, body: Record<string, unknown>, x = deps()) => status(handleDesk(await sign(who), body, x.d));

describe("operator-desk sign-in", () => {
  it("refuses a token signed by another key", async () => { assert.equal(await status(handleDesk(await sign(OWNER, { key: other }), { action: "list" }, deps().d)), 401); });
  it("refuses an expired token", async () => { assert.equal(await status(handleDesk(await sign(OWNER, { exp: Math.floor(Date.now() / 1000) - 60 }), { action: "list" }, deps().d)), 401); });
  it("refuses a token from another issuer", async () => { assert.equal(await status(handleDesk(await sign(OWNER, { iss: "https://evil.example/auth/v1" }), { action: "list" }, deps().d)), 401); });
  it("refuses a missing token", async () => { assert.equal(await status(handleDesk("", { action: "list" }, deps().d)), 401); });
  it("refuses an unknown action", async () => { assert.equal(await call(OWNER, { action: "drop_tables" }), 400); });
});

describe("who gets a desk", () => {
  it("yard owner A gets only yard A (staff role on yard B does not count)", async () => {
    const r: any = await handleDesk(await sign(DEALER_A), { action: "whoami" }, deps().d);
    assert.deepEqual(r.accounts.map((a: any) => a.id), [A]);
  });
  for (const [name, who] of [["staff", STAFF_A], ["admin", ADMIN_A], ["buyer", BUYER]] as const) {
    it(`${name} is treated like a buyer: no desk, no 'no desk yet', no data`, async () => {
      assert.deepEqual(await handleDesk(await sign(who), { action: "whoami" }, deps().d), { owner: false, desk: false, has_membership: false, accounts: [] });
      for (const action of ["list", "update", "watch", "hunt", "score", "send_to_dealer", "remove_anchor", "finds_list", "finds_update", "finds_scan"]) {
        assert.equal(await call(who, { action, id: OPP_A, patch: { is_starred: true }, anchor_sale_id: "s1", status: "starred" }), 403, action);
      }
    });
  }
  it("owner of an unlinked yard gets 'no desk yet'", async () => {
    assert.deepEqual(await handleDesk(await sign(UNLINKED), { action: "whoami" }, deps().d), { owner: false, desk: false, has_membership: true, accounts: [] });
  });
});

describe("reads", () => {
  it("yard owner A reads only cars touching yard A, with other yards' matches removed", async () => {
    const r: any = await handleDesk(await sign(DEALER_A), { action: "list" }, deps().d);
    assert.deepEqual(r.opportunities.map((o: Opp) => o.id), [OPP_A, OPP_A_TAKEN_B, OPP_B_GIVEN_A]);
    assert.deepEqual(r.opportunities[0].alt_matches, [{ account_id: A }]);
  });
  it("yard owner A cannot ask for yard B", async () => { assert.equal(await call(DEALER_A, { action: "list", account_id: B }), 403); });
  it("owner_access sees all three yards and unassigned cars", async () => {
    const r: any = await handleDesk(await sign(OWNER), { action: "list" }, deps().d);
    assert.equal(r.opportunities.length, 6);
    assert.deepEqual(r.accounts.map((a: any) => a.id), [A, B, C]);
  });
});

describe("cross-yard write rule", () => {
  for (const patch of [{ status: "reviewed" }, { is_starred: true }, { reminder_at: "2026-12-01T00:00:00Z" }, { assigned_to_account: A }]) {
    it(`A cannot ${Object.keys(patch)[0]} a car best-matched to A but assigned to B`, async () => {
      const x = deps(); assert.equal(await call(DEALER_A, { action: "update", id: OPP_A_TAKEN_B, patch }, x), 403); assert.deepEqual(x.log, []);
    });
  }
  it("A can change a car assigned to A (even if best-matched to B)", async () => { const x = deps(); assert.equal(await call(DEALER_A, { action: "update", id: OPP_B_GIVEN_A, patch: { status: "reviewed" } }, x), 200); assert.deepEqual(x.log, [`update:${OPP_B_GIVEN_A}`]); });
  it("A can claim an unassigned car best-matched to A", async () => { assert.equal(await call(DEALER_A, { action: "update", id: OPP_A, patch: { assigned_to_account: A } }), 200); });
  it("A cannot claim an unassigned car best-matched to B", async () => { const x = deps(); assert.equal(await call(DEALER_A, { action: "update", id: OPP_B, patch: { assigned_to_account: A } }, x), 403); assert.deepEqual(x.log, []); });
  it("A cannot assign its own car to yard B", async () => { assert.equal(await call(DEALER_A, { action: "update", id: OPP_A, patch: { assigned_to_account: B } }), 403); });
  it("rejects fields outside the allow-list", async () => { assert.equal(await call(DEALER_A, { action: "update", id: OPP_A, patch: { best_account_id: B } }), 400); });
  it("owner_access can reassign any car", async () => { assert.equal(await call(OWNER, { action: "update", id: OPP_A_TAKEN_B, patch: { assigned_to_account: C } }), 200); });
});

describe("watch and hunt", () => {
  it("yard owner can watch and hunt its own car, filed under its own yard", async () => {
    const x = deps();
    assert.equal(await call(DEALER_A, { action: "watch", id: OPP_A, account_id: B }, x), 200);
    assert.equal(await call(DEALER_A, { action: "hunt", id: OPP_A, account_id: B }, x), 200);
    assert.equal(x.log[0], `star-watch-dispatch:${JSON.stringify({ listing_id: `L-${OPP_A}`, account_id: A })}`);
    assert.equal(x.mandates[0].account_id, A);
    assert.equal(x.mandates[0].year_min, 2018); assert.equal(x.mandates[0].km_max, 105000);
  });
  it("yard owner cannot watch or hunt another yard's car", async () => {
    for (const action of ["watch", "hunt"]) { assert.equal(await call(DEALER_A, { action, id: OPP_B }), 403); assert.equal(await call(DEALER_A, { action, id: OPP_A_TAKEN_B }), 403); }
  });
  it("owner_access can watch and hunt any car", async () => { assert.equal(await call(OWNER, { action: "watch", id: OPP_C }), 200); assert.equal(await call(OWNER, { action: "hunt", id: OPP_C }), 200); });
});

describe("owner_access-only actions", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["score", {}, "score-operator-opportunities"],
    ["send_to_dealer", { id: OPP_A }, "push-send"],
    ["remove_anchor", { id: OPP_A, anchor_sale_id: "s1" }, `update:${OPP_A}`],
    ["finds_list", {}, ""],
    ["finds_update", { id: OPP_A, status: "starred" }, "find"],
    ["finds_scan", {}, "market-scanner"],
  ];
  for (const [action, extra, effect] of cases) {
    it(`${action}: owner_access allowed, yard owner 403`, async () => {
      const x = deps(); assert.equal(await call(OWNER, { action, ...extra }, x), 200);
      if (effect) assert.ok(x.log.some((l) => l.startsWith(effect)), x.log.join());
      const y = deps(); assert.equal(await call(DEALER_A, { action, ...extra }, y), 403); assert.deepEqual(y.log, []);
    });
  }
  it("send_to_dealer builds the message from the stored car, not browser text", async () => {
    const x = deps(); await call(OWNER, { action: "send_to_dealer", id: OPP_A, title: "evil", dealer_name: "Other" }, x);
    const body = JSON.parse(x.log[0].slice("push-send:".length)); assert.equal(body.dealer_name, "Yard"); assert.notEqual(body.title, "evil");
  });
  it("finds_update rejects unknown statuses", async () => { assert.equal(await call(OWNER, { action: "finds_update", id: OPP_A, status: "deleted" }), 400); });
});
