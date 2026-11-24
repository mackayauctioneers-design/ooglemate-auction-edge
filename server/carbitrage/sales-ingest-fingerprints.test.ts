import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fingerprintId, fingerprintMetrics, parseFingerprints, parseRetire, receiveFingerprints } from "../../supabase/functions/sales-ingest/fingerprints.ts";
import type { DealerProfile, ExistingFingerprint, FingerprintCell, FingerprintMetrics, FingerprintStore, NewFingerprint } from "../../supabase/functions/sales-ingest/fingerprints.ts";

const account = "d24da4ea-f500-47fd-9b66-d2c9aa2d3f51";
const profile: DealerProfile = { id: "ffdbbf25-1d9c-4402-ba49-fc4da4b77cb6", account_id: account, dealer_name: "Mackay Traders" };
const cell: FingerprintCell = { level: "group", cell_key: "Toyota|Hilux||", make: "Toyota", model: "Hilux", badge: "", year_min: 2006, year_max: 2026, km_max: 400000, n_sales_120: 16, avg_gross_120: 1243.78, updated_at: "2026-11-24T17:53:38+11:00" };
const body = (row: unknown = cell) => ({ action: "fingerprints", account_id: account, rows: [row] });
class Store implements FingerprintStore {
  dealerProfiles: DealerProfile[] = [profile];
  rows = new Map<string, ExistingFingerprint & { is_active?: boolean; alert_enabled?: boolean }>();
  writes = 0;
  conflict = false;
  async profiles() { return this.dealerProfiles; }
  async existing(ids: string[]) { return [...this.rows.values()].filter((row) => ids.includes(row.fingerprint_id)); }
  async insert(row: NewFingerprint) {
    if (this.conflict || this.rows.has(row.fingerprint_id)) return false;
    this.writes++;
    this.rows.set(row.fingerprint_id, { ...row });
    return true;
  }
  async update(row: FingerprintMetrics) {
    const previous = this.rows.get(row.fingerprint_id);
    if (this.conflict || !previous) return false;
    this.writes++;
    // Mirror the database trigger's server-managed timestamp.
    this.rows.set(row.fingerprint_id, { ...previous, ...row, updated_at: "2026-11-24T08:25:00Z" });
    return true;
  }
}
const allowed = new Set([account]);

describe("VPS fingerprint write-back", () => {
  it("keys group rows by account + level + cell_key, never km_band", () => {
    assert.equal(fingerprintId(account, cell), 'vps-winner:["d24da4ea-f500-47fd-9b66-d2c9aa2d3f51","group","Toyota|Hilux||"]');
    assert.equal(fingerprintId(account, { ...cell, km_band: "200k+" } as FingerprintCell), fingerprintId(account, cell));
  });
  it("preserves the exact-row km split already inside cell_key", () => {
    const exact = { ...cell, level: "exact" as const, cell_key: "Toyota|Hilux|SR5||2018|200k+" };
    assert.ok(fingerprintId(account, exact).endsWith('"exact","Toyota|Hilux|SR5||2018|200k+"]'));
    assert.notEqual(fingerprintId(account, exact), fingerprintId(account, { ...exact, cell_key: "Toyota|Hilux|SR5||2018|100k+" }));
  });
  it("isolates identical cells across accounts", () => {
    assert.notEqual(fingerprintId(account, cell), fingerprintId("8140eae1-2c36-40b6-a358-4f5ed05bbbcf", cell));
  });
  it("isolates group and mandate levels even with the same cell key", () => {
    assert.notEqual(fingerprintId(account, cell), fingerprintId(account, { ...cell, level: "mandate" }));
  });
  it("maps the recent 16 sales and 1243.78 gross without using all-time or adjusted figures", () => {
    const metrics = fingerprintMetrics(account, profile, cell);
    assert.equal(metrics.sales_count, 16);
    assert.equal(metrics.avg_profit, 1243.78);
    assert.equal(metrics.avg_days_to_sell, null);
    assert.equal(metrics.variant_family, null);
    assert.equal(metrics.max_km, 400000);
    assert.equal(metrics.year_min, 2006);
    assert.equal(metrics.year_max, 2026);
  });
  for (const field of ["top_sources", "top_buyers", "example_sales", "rego", "vin", "customer", "dealer_profile_id", "is_active", "alert_enabled", "score", "weight", "med_days", "n_sales", "avg_gross", "adj_med_gross"]) {
    it(`rejects ${field} rather than importing raw/private or managed fields`, () => {
      assert.throws(() => parseFingerprints(body({ ...cell, [field]: "untrusted" })), /unknown_fingerprint_field/);
    });
  }
  it("rejects invalid values and malformed timestamps before lookup", () => {
    for (const changes of [{ n_sales_120: -1 }, { km_max: -1 }, { avg_gross_120: NaN }, { year_max: 2000 }, { updated_at: "today" }, { level: "unknown" }]) {
      assert.throws(() => parseFingerprints(body({ ...cell, ...changes })), /invalid_fingerprint_row/);
    }
  });
  it("rejects duplicate keys in a batch", () => {
    assert.throws(() => parseFingerprints({ ...body(), rows: [cell, cell] }), /duplicate_fingerprint/);
  });
  it("accepts at most 600 rows", () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ ...cell, cell_key: `Toyota|Hilux|${i}|` }));
    assert.equal(parseFingerprints({ ...body(), rows }).cells.length, 600);
    assert.throws(() => parseFingerprints({ ...body(), rows: [...rows, cell] }), /rows_required_1_to_600/);
  });
  it("blocks an unapproved account without writing", async () => {
    const store = new Store();
    await assert.rejects(receiveFingerprints(body(), new Set(), store), /account_not_allowed/);
    assert.equal(store.writes, 0);
  });
  it("holds Shed when there is no dealer profile", async () => {
    const shed = "a2aec451-3b68-47f1-aaa8-ce7ef470b30d";
    const store = new Store(); store.dealerProfiles = [];
    await assert.rejects(receiveFingerprints({ ...body(), account_id: shed }, new Set([shed]), store), /dealer_profile_required/);
    assert.equal(store.writes, 0);
  });
  it("blocks ambiguous and mismatched profile resolution", async () => {
    const store = new Store(); store.dealerProfiles = [profile, profile];
    await assert.rejects(receiveFingerprints(body(), allowed, store), /dealer_profile_required/);
    store.dealerProfiles = [{ ...profile, account_id: "8140eae1-2c36-40b6-a358-4f5ed05bbbcf" }];
    await assert.rejects(receiveFingerprints(body(), allowed, store), /profile_account_mismatch/);
    assert.equal(store.writes, 0);
  });
  it("checks ownership of the entire batch before inserting anything", async () => {
    const store = new Store();
    const second = { ...cell, cell_key: "Toyota|Corolla||", model: "Corolla" };
    const wrong = { ...fingerprintMetrics(account, profile, second), dealer_profile_id: "other-profile" };
    store.rows.set(wrong.fingerprint_id, wrong);
    await assert.rejects(receiveFingerprints({ ...body(), rows: [cell, second] }, allowed, store), /fingerprint_profile_mismatch/);
    assert.equal(store.writes, 0);
  });
  it("inserts inactive, alerts-off patterns and skips identical retries", async () => {
    const store = new Store();
    assert.deepEqual(await receiveFingerprints(body(), allowed, store), { received: 1, inserted: 1, updated: 0, skipped: 0, retry_required: false });
    const inserted = store.rows.get(fingerprintId(account, cell));
    assert.equal(inserted?.is_active, false);
    assert.equal(inserted?.alert_enabled, false);
    assert.deepEqual(await receiveFingerprints(body(), allowed, store), { received: 1, inserted: 0, updated: 0, skipped: 1, retry_required: false });
    assert.equal(store.writes, 1);
  });
  it("refreshes the same identity, preserving existing activation and alert settings", async () => {
    const store = new Store();
    const original = { ...fingerprintMetrics(account, profile, cell), is_active: true, alert_enabled: true };
    store.rows.set(original.fingerprint_id, original);
    const next = { ...cell, avg_gross_120: 1300, updated_at: "2026-11-24T19:00:00+11:00" };
    assert.equal((await receiveFingerprints(body(next), allowed, store)).updated, 1);
    assert.equal(store.rows.size, 1);
    assert.equal(store.rows.get(original.fingerprint_id)?.avg_profit, 1300);
    assert.equal(store.rows.get(original.fingerprint_id)?.is_active, true);
    assert.equal(store.rows.get(original.fingerprint_id)?.alert_enabled, true);
    assert.equal((await receiveFingerprints(body(next), allowed, store)).skipped, 1);
  });
  it("does not overwrite the existing owner-buy Hilux SR5 identity", async () => {
    const store = new Store();
    const owner = { ...fingerprintMetrics(account, profile, cell), fingerprint_id: "dave-hilux-sr5-2018-2022", variant_family: "SR5", is_active: true };
    store.rows.set(owner.fingerprint_id, owner);
    await receiveFingerprints(body(), allowed, store);
    assert.deepEqual(store.rows.get(owner.fingerprint_id), owner);
    assert.equal(store.rows.size, 2);
  });
  it("requests retry when the row write does not land", async () => {
    const store = new Store(); store.conflict = true;
    assert.equal((await receiveFingerprints(body(), allowed, store)).retry_required, true);
    assert.equal(store.writes, 0);
  });
  it("stops at the 110-second time budget with resumable counts", async () => {
    const store = new Store(); let calls = 0;
    const result = await receiveFingerprints(body(), allowed, store, () => calls++ === 0 ? 0 : 110000);
    assert.equal(result.retry_required, true);
    assert.equal(result.inserted, 0);
    assert.equal(store.writes, 0);
  });
  it("skips a replay when the database returns numeric columns as strings", async () => {
    const store = new Store();
    const stored = { ...fingerprintMetrics(account, profile, cell), avg_profit: "1243.78" as unknown as number, updated_at: "2026-11-24 06:53:38+00", is_active: true };
    store.rows.set(stored.fingerprint_id, stored);
    assert.deepEqual(await receiveFingerprints(body(), allowed, store), { received: 1, inserted: 0, updated: 0, skipped: 1, retry_required: false });
    assert.equal(store.writes, 0);
  });
  it("parses deactivate requests into the same tenant-scoped IDs", () => {
    const r = parseRetire({ action: "fingerprints_deactivate", account_id: account, cells: [{ level: "group", cell_key: "Toyota|Hilux||" }] });
    assert.deepEqual(r.ids, [fingerprintId(account, cell)]);
    assert.throws(() => parseRetire({ action: "fingerprints_deactivate", account_id: account, cells: [] }), /cells_required/);
  });
});
