import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, jwtVerify } from "jose";
import { handleDesk, type DeskStore, type Opp } from "../../supabase/functions/operator-desk/scope.ts";

const ISS = "https://esyinwxhcpexncgqcnwi.supabase.co/auth/v1";
const A = "d24da4ea-f500-47fd-9b66-d2c9aa2d3f51", B = "8140eae1-2c36-40b6-a358-4f5ed05bbbcf", C = "a2aec451-3b68-47f1-aaa8-ce7ef470b30d";
const DEALER_A = "11111111-1111-4111-8111-111111111111", OWNER = "22222222-2222-4222-8222-222222222222", BUYER = "33333333-3333-4333-8333-333333333333", UNLINKED = "44444444-4444-4444-8444-444444444444";
const OPP_A = "aaaaaaaa-0000-4000-8000-000000000001", OPP_B = "bbbbbbbb-0000-4000-8000-000000000002", OPP_C = "cccccccc-0000-4000-8000-000000000003", OPP_NONE = "dddddddd-0000-4000-8000-000000000004";
const members: Record<string, string[]> = { [DEALER_A]: ["yard-a"], [UNLINKED]: ["yard-acm"], [BUYER]: [], [OWNER]: [] };
const links: Record<string, string> = { "yard-a": A, "yard-b": B, "yard-c": C };

let key: CryptoKey, other: CryptoKey, verify: (t: string) => Promise<any>;
before(async () => {
  const kp = await generateKeyPair("ES256"); key = kp.privateKey as CryptoKey;
  other = (await generateKeyPair("ES256")).privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "ES256" };
  const set = createLocalJWKSet({ keys: [jwk] });
  verify = (t) => jwtVerify(t, set, { issuer: ISS, audience: "authenticated", algorithms: ["ES256"] });
});
const sign = (sub: string, o: { key?: CryptoKey; exp?: string | number; iss?: string } = {}) =>
  new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: "k1" }).setSubject(sub).setIssuer(o.iss ?? ISS).setAudience("authenticated").setIssuedAt().setExpirationTime(o.exp ?? "1h").sign(o.key ?? key);

function deps() {
  const opps: Opp[] = [
    { id: OPP_A, best_account_id: A, status: "new", alt_matches: [{ account_id: A }, { account_id: B, account_name: "AJH" }] },
    { id: OPP_B, best_account_id: B, status: "new" },
    { id: OPP_C, best_account_id: C, status: "new" },
    { id: OPP_NONE, best_account_id: null, status: "new" },
  ];
  const updates: string[] = [];
  const accounts = [{ id: A, display_name: "Mackay" }, { id: B, display_name: "AJH" }, { id: C, display_name: "Shed" }];
  const store: DeskStore = {
    isOwner: async (id) => id === OWNER,
    yardAccounts: async (ds) => ds.map((d) => links[d]).filter(Boolean),
    accounts: async (ids) => ids === null ? accounts : accounts.filter((a) => ids.includes(a.id)),
    // Deliberately unfiltered: the handler must still drop other yards' rows.
    listOpps: async () => ({ active: opps, starred: [] }),
    getOpp: async (id) => opps.find((o) => o.id === id) ?? null,
    updateOpp: async (id) => { updates.push(id); },
  };
  return { store, updates, d: { verify, store, memberships: async (_t: string, sub: string) => (members[sub] ?? []).map((dealership_id) => ({ dealership_id })) } };
}
const status = async (p: Promise<unknown>) => { try { await p; return 200; } catch (e: any) { return e.status ?? 500; } };

describe("operator-desk yard scope", () => {
  it("refuses a token signed by another key", async () => { assert.equal(await status(handleDesk(await sign(OWNER, { key: other }), { action: "list" }, deps().d)), 401); });
  it("refuses an expired token", async () => { assert.equal(await status(handleDesk(await sign(OWNER, { exp: Math.floor(Date.now() / 1000) - 60 }), { action: "list" }, deps().d)), 401); });
  it("refuses a token from another issuer", async () => { assert.equal(await status(handleDesk(await sign(OWNER, { iss: "https://evil.example/auth/v1" }), { action: "list" }, deps().d)), 401); });
  it("refuses a missing token", async () => { assert.equal(await status(handleDesk("", { action: "list" }, deps().d)), 401); });
  it("dealer A reads only yard A", async () => {
    const r: any = await handleDesk(await sign(DEALER_A), { action: "list" }, deps().d);
    assert.deepEqual(r.opportunities.map((o: Opp) => o.id), [OPP_A]);
    assert.deepEqual(r.accounts.map((a: any) => a.id), [A]);
    assert.deepEqual(r.opportunities[0].alt_matches, [{ account_id: A }]);
  });
  it("dealer A cannot ask for yard B", async () => { assert.equal(await status(handleDesk(await sign(DEALER_A), { action: "list", account_id: B }, deps().d)), 403); });
  it("dealer A cannot update a yard B car", async () => {
    const x = deps();
    assert.equal(await status(handleDesk(await sign(DEALER_A), { action: "update", id: OPP_B, patch: { is_starred: true } }, x.d)), 403);
    assert.deepEqual(x.updates, []);
  });
  it("dealer A cannot assign a car to yard B", async () => { assert.equal(await status(handleDesk(await sign(DEALER_A), { action: "update", id: OPP_A, patch: { assigned_to_account: B } }, deps().d)), 403); });
  it("dealer A can star a yard A car", async () => { const x = deps(); await handleDesk(await sign(DEALER_A), { action: "update", id: OPP_A, patch: { is_starred: true } }, x.d); assert.deepEqual(x.updates, [OPP_A]); });
  it("rejects fields outside the allow-list", async () => { assert.equal(await status(handleDesk(await sign(DEALER_A), { action: "update", id: OPP_A, patch: { best_account_id: B } }, deps().d)), 400); });
  it("owner sees all three yards and unassigned cars", async () => {
    const r: any = await handleDesk(await sign(OWNER), { action: "list" }, deps().d);
    assert.equal(r.owner, true);
    assert.deepEqual(r.opportunities.map((o: Opp) => o.id), [OPP_A, OPP_B, OPP_C, OPP_NONE]);
    assert.deepEqual(r.accounts.map((a: any) => a.id), [A, B, C]);
  });
  it("buyer with no membership is refused desk data", async () => {
    const t = await sign(BUYER);
    assert.equal(await status(handleDesk(t, { action: "list" }, deps().d)), 403);
    assert.deepEqual(await handleDesk(t, { action: "whoami" }, deps().d), { owner: false, desk: false, has_membership: false, accounts: [] });
  });
  it("member of an unlinked yard gets no desk", async () => {
    const r: any = await handleDesk(await sign(UNLINKED), { action: "whoami" }, deps().d);
    assert.deepEqual(r, { owner: false, desk: false, has_membership: true, accounts: [] });
  });
  it("refuses an unknown action", async () => { assert.equal(await status(handleDesk(await sign(OWNER), { action: "drop_tables" }, deps().d)), 400); });
});
