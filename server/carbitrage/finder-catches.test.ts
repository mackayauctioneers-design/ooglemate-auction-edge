import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CatchInputError, KNOWN_ACTIONS, countUpsert, parseCatches, parseCoverage } from "../../supabase/functions/sales-ingest/catches.ts";
import { expiryReason, withManheimEnd } from "../../supabase/functions/_shared/deskFreshness.ts";
import { countdown, coverageStrip, foundLabel, gapLabel, kmLabel } from "../../src/components/trading-desk/caughtPresentation.ts";
import { handleDesk, type DeskStore } from "../../supabase/functions/operator-desk/scope.ts";

const err = (fn: () => unknown, msg: string) => assert.throws(fn, (e: unknown) => e instanceof CatchInputError && e.message === msg);
const base = { catch_id: "c1", found_at: "2026-11-25T02:14:00Z", source: "carsales" };

describe("sales-ingest actions", () => {
  it("knows exactly the five actions", () => {
    assert.deepEqual([...KNOWN_ACTIONS].sort(), ["existing", "finder_catches", "fingerprints", "fingerprints_deactivate", "source_coverage"]);
  });
  it("finder_catches needs 1 to 300 rows", () => {
    err(() => parseCatches([]), "rows_required_1_to_300");
    err(() => parseCatches(Array.from({ length: 301 }, (_, i) => ({ ...base, catch_id: `c${i}` }))), "rows_required_1_to_300");
    assert.equal(parseCatches(Array.from({ length: 300 }, (_, i) => ({ ...base, catch_id: `c${i}` }))).length, 300);
  });
  it("rejects unknown fields and requires catch_id, found_at, source", () => {
    err(() => parseCatches([{ ...base, rego: "ABC123" }]), "unknown_field");
    err(() => parseCatches([{ found_at: base.found_at, source: "x" }]), "missing_required");
    err(() => parseCatches([{ catch_id: "c", source: "x" }]), "missing_required");
  });
  it("only allows live/expired/sold/bought statuses", () => {
    for (const s of ["live", "expired", "sold", "bought"]) assert.equal(parseCatches([{ ...base, status: s }])[0].status, s);
    err(() => parseCatches([{ ...base, status: "deleted" }]), "bad_value");
  });
  it("source_coverage keys on date + source and validates sales", () => {
    const rows = parseCoverage([{ date: "2026-11-25", source: "manheim", sales: [{ sale: "Milperra Tuesday", lots: 120, closes_at: "2026-11-25T08:30:00Z" }] }]);
    assert.equal(rows.length, 1);
    err(() => parseCoverage([{ date: "2026-11-25", source: "a" }, { date: "2026-11-25", source: "a" }]), "duplicate_date_source");
    err(() => parseCoverage([{ source: "a" }]), "missing_required");
    err(() => parseCoverage([{ date: "2026-11-25", source: "a", sales: [{ sale: "x", buyer: "y" }] }]), "bad_value");
  });
  it("counts inserted vs updated from pre-existing keys", () => {
    assert.deepEqual(countUpsert(["a", "b", "c"], new Set(["b"])), { inserted: 2, updated: 1 });
  });
});

describe("Manheim auction end from coverage", () => {
  const sales = [{ sale: "Milperra Tuesday", lots: 120, closes_at: "2026-11-25T08:30:00Z" }];
  it("fills a missing end from the matching sale and expires after it", () => {
    const o = withManheimEnd({ listing_source: "manheim", auction_datetime: null }, { auction_location: "milperra  tuesday" }, sales);
    assert.equal(o.auction_datetime, "2026-11-25T08:30:00Z");
    assert.equal(expiryReason(o, undefined, new Date("2026-11-25T09:00:00Z")), "auction_ended");
  });
  it("never overwrites a real per-lot end, and ignores other houses", () => {
    assert.equal(withManheimEnd({ listing_source: "manheim", auction_datetime: "2026-11-26T01:00:00Z" }, { auction_location: "Milperra Tuesday" }, sales).auction_datetime, "2026-11-26T01:00:00Z");
    assert.equal(withManheimEnd({ listing_source: "manheim", auction_datetime: null }, { auction_datetime: "2026-11-27T01:00:00Z", auction_location: "Milperra Tuesday" }, sales).auction_datetime, null);
    assert.equal(withManheimEnd({ listing_source: "pickles", auction_datetime: null }, { auction_location: "Milperra Tuesday" }, sales).auction_datetime, null);
  });
});

describe("Caught presentation", () => {
  it("formats Sydney found time, km and gap", () => {
    assert.equal(foundLabel("2026-11-25T02:14:00Z"), "Wed 1:14pm");
    assert.equal(kmLabel(108000), "108ks");
    assert.equal(gapLabel(2400, 8.12), "$2,400 · 8.1%");
    assert.equal(countdown("2026-11-25T03:00:00Z", Date.parse("2026-11-25T01:48:00Z")), "1h 12m");
  });
  it("coverage chips go red when quiet, erroring or missing since yesterday", () => {
    const now = Date.parse("2026-11-25T02:00:00Z"); // Sydney 25 Nov
    const { date, chips } = coverageStrip([
      { date: "2026-11-25", source: "carsales", listings_scanned: 900, new: 40, catches: 3, errors: 0, quiet: false },
      { date: "2026-11-25", source: "manheim", errors: 2 },
      { date: "2026-11-25", source: "memo23_receiver", quiet: true },
      { date: "2026-11-24", source: "dealer_site:abc" },
      { date: "2026-11-24", source: "carsales" },
    ], now);
    assert.equal(date, "2026-11-25");
    const red = Object.fromEntries(chips.map((c) => [c.source, c.red]));
    assert.deepEqual(red, { carsales: false, manheim: true, memo23_receiver: true, "dealer_site:abc": true });
  });
  it("falls back to the latest date when today has no rows", () => {
    assert.equal(coverageStrip([{ date: "2026-11-23", source: "a" }], Date.parse("2026-11-25T02:00:00Z")).date, "2026-11-23");
  });
});

describe("operator-desk Caught actions", () => {
  const store = (owner: boolean) => ({
    isOwner: async () => owner, yardAccounts: async () => ["a1"], accounts: async () => [],
    listCatches: async (q: any) => ({ rows: [q], total: 1 }), listCoverage: async () => [{ date: "2026-11-25", source: "x" }],
  } as unknown as DeskStore);
  const deps = (owner: boolean) => ({
    verify: async () => ({ payload: { sub: "11111111-1111-1111-1111-111111111111", exp: 9_999_999_999 } }),
    memberships: async () => [{ dealership_id: "d1", role: "owner" }], store: store(owner),
  });
  it("refuses yard owners", async () => {
    await assert.rejects(handleDesk("a.b.c", { action: "caught_list" }, deps(false)), (e: any) => e.status === 403);
    await assert.rejects(handleDesk("a.b.c", { action: "coverage_list" }, deps(false)), (e: any) => e.status === 403);
  });
  it("pages 50 at a time for the owner", async () => {
    const r: any = await handleDesk("a.b.c", { action: "caught_list", page: 2, source: "carsales", status: "live" }, deps(true));
    assert.deepEqual(r.rows[0], { offset: 100, limit: 50, source: "carsales", status: "live" });
  });
});
