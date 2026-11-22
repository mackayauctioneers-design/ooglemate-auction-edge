import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_POLL_MS, activitySchema, activityTime, activityUrl, mergeActivity, summarySchema, updatedMinutes } from "../../src/portal/desk/activityData.ts";
import { isDeskPreview, safeAdUrl } from "../../src/portal/desk/data.ts";

describe("desk summary and activity rules", () => {
  it("polls every 60 seconds", () => { assert.equal(ACTIVITY_POLL_MS, 60_000); });
  it("passes an ISO since cursor to the activity GET URL", () => {
    const url = new URL(activityUrl("2026-11-22T08:47:00Z"));
    assert.equal(url.pathname, "/api/carbitrage/desk/activity");
    assert.equal(url.searchParams.get("since"), "2026-11-22T08:47:00Z");
  });
  it("preserves server counters and never invents missing values", () => {
    const result = summarySchema.parse({ scanned_today: 431, buy_ready: 0, matched_to_you: null });
    assert.equal(result.scanned_today, 431); assert.equal(result.buy_ready, 0);
    assert.equal(result.matched_to_you, null); assert.equal(result.stock_over_market, undefined);
    assert.equal(summarySchema.safeParse({}).success, false);
  });
  it("merges incremental rows newest first without duplicates", () => {
    const older = { id: "a", time: "2026-11-22T08:00:00Z", event: "Checked listings" };
    const newer = { id: "b", time: "2026-11-22T08:47:00Z", event: "Matched a car" };
    assert.deepEqual(mergeActivity([older], [older, newer]).map((row) => row.id), ["b", "a"]);
    assert.equal(mergeActivity([older], []).length, 1);
  });
  it("uses Sydney time", () => { assert.match(activityTime("2026-11-22T08:47:00Z"), /7:47\s?pm/i); });
  it("calculates elapsed full minutes since a successful update", () => { assert.equal(updatedMinutes(1000, 181000), 3); });
  it("keeps examples restricted to preview", () => {
    assert.equal(isDeskPreview("www.carbitrage.com.au", true), false);
    assert.equal(isDeskPreview("ooglemate-auction-edge.lovable.app", true), false);
    assert.equal(isDeskPreview("localhost", true), true);
  });
  it("accepts events with optional car links and rejects executable URLs", () => {
    const rows = activitySchema.parse({ events: [{ time: "2026-11-22T08:47:00Z", event: "Matched a car", car_url: "https://example.com/car" }] });
    assert.equal(safeAdUrl(rows[0]?.car_url), "https://example.com/car");
    assert.equal(safeAdUrl("javascript:alert(1)"), null);
  });
});