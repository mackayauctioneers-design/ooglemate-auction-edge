import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { confidenceLabel, exampleDesk, filterQueue, floorFigures, isDeskPreview, queueSchema, safeAdUrl } from "../../src/portal/desk/data.ts";

describe("dealer desk display rules", () => {
  it("shows High confidence for 5+ sales", () => { assert.equal(confidenceLabel(5), "High"); assert.equal(confidenceLabel(9), "High"); });
  it("shows Medium confidence for 3–4 sales", () => { assert.equal(confidenceLabel(3), "Medium"); assert.equal(confidenceLabel(4), "Medium"); });
  it("keeps 1–2-sale shapes worth re-testing", () => { assert.equal(confidenceLabel(1), "worth re-testing"); assert.equal(confidenceLabel(2), "worth re-testing"); });
  it("never enables example fallback on the live domain", () => { assert.equal(isDeskPreview("www.carbitrage.com.au", true), false); assert.equal(isDeskPreview("carbitrage.com.au", true), false); assert.equal(isDeskPreview("ooglemate-auction-edge.lovable.app", true), false); });
  it("limits fallback to local development and project previews", () => { assert.equal(isDeskPreview("localhost", true), true); assert.equal(isDeskPreview("id-preview--92b962ba-8cbd-4e77-b734-dd01c5a9be50.lovable.app"), true); assert.equal(isDeskPreview("unrelated.lovable.app", true), false); });
  it("suppresses all buy figures when no_floor is set", () => { const row = exampleDesk().queue[0]; assert.ok(row); assert.equal(floorFigures({ ...row, no_floor: true, cautious_buy: 12345 }), null); });
  it("displays supplied cautious buy without browser price maths", () => { const row = exampleDesk().queue[0]; assert.ok(row); assert.equal(floorFigures({ ...row, cautious_buy: 12345 })?.buy, 12345); });
  it("filters auctions and retail while preserving feed ranking", () => { const { queue } = exampleDesk(); assert.deepEqual(filterQueue(queue, "auction", false).map((v) => v.id), ["example-2"]); assert.deepEqual(filterQueue(queue, "retail", false).map((v) => v.id), ["example-1", "example-3"]); });
  it("New today uses Sydney's day across UTC midnight boundaries", () => { const row = exampleDesk().queue[0]; assert.ok(row); const rows = [{ ...row, found_at: "2026-11-21T13:30:00Z" }, { ...row, id: "old", found_at: "2026-11-21T12:30:00Z" }]; assert.equal(filterQueue(rows, "all", true, new Date("2026-11-22T01:21:00Z")).length, 1); });
  it("accepts null money for staff without converting it to zero", () => { const row = exampleDesk().queue[0]; assert.ok(row); const parsed = queueSchema.parse([{ ...row, asking_price: null, floor_car_price: null, cautious_buy: null }]); assert.equal(parsed[0]?.asking_price, null); assert.equal(parsed[0]?.cautious_buy, null); });
  it("rejects executable ad URLs", () => { assert.equal(safeAdUrl("javascript:alert(1)"), null); assert.equal(safeAdUrl("https://example.com/car"), "https://example.com/car"); });
});