import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auctionGroups, auctionsSchema, exampleYard, sortStock, stockGap, stockSchema, wholesaleStockLink, yardMoney } from "../../src/portal/desk/yardData.ts";

describe("stock and closing auction display rules", () => {
  const now = new Date("2026-11-22T07:26:00Z");
  const stock = exampleYard(now).stock;
  const first = stock[0];
  if (!first) throw new Error("Missing fixture");
  it("displays API stages without recalculating thresholds", () => {
    assert.deepEqual(stockSchema.parse(stock).map(row => row.stage), ["Exit", "Act", "Watch", "Good"]);
    assert.equal(stockSchema.parse([{ ...first, days_in_stock: 5, stage: "Exit" }])[0]?.stage, "Exit");
  });
  it("orders needs action by supplied gap, then age", () => {
    assert.deepEqual(sortStock([{ ...first, stock_no: "older", gap: 800, days_in_stock: 110 }, { ...first, stock_no: "over", gap: 2100, days_in_stock: 10 }, { ...first, stock_no: "younger", gap: 800, days_in_stock: 30 }], "action").map(row => row.stock_no), ["over", "older", "younger"]);
  });
  it("oldest ordering ignores the price gap", () => { assert.deepEqual(sortStock([{ ...first, stock_no: "young", days_in_stock: 10, gap: 5000 }, { ...first, stock_no: "old", days_in_stock: 110, gap: -800 }], "oldest").map(row => row.stock_no), ["old", "young"]); });
  it("does not calculate missing gaps from prices", () => { assert.equal(stockGap({ ...first, gap: undefined }), ""); assert.equal(stockGap({ ...first, asking_price: 1, floor_price: 99999, gap: 2100 }), "$2.1k over"); });
  it("formats a supplied negative gap as $800 under", () => { assert.equal(stockGap({ ...first, gap: -800 }), "$800 under"); });
  it("keeps omitted staff money blank", () => { assert.equal(yardMoney(undefined), ""); assert.equal(yardMoney(null), ""); assert.equal(stockGap({ ...first, asking_price: undefined }), ""); });
  it("strips other dealer identity, stock and prices from auction payloads", () => {
    const row = exampleYard(now).auctions[0]; assert.ok(row);
    const parsed = auctionsSchema.parse([{ ...row, dealer_name: "Other dealer", stock_no: "SECRET", dealer_price: 123 }])[0];
    assert.equal("dealer_name" in (parsed ?? {}), false); assert.equal("stock_no" in (parsed ?? {}), false); assert.equal("dealer_price" in (parsed ?? {}), false);
  });
  it("keeps auction max bid exactly as supplied", () => { const row = exampleYard(now).auctions[0]; assert.ok(row); assert.equal(auctionsSchema.parse([{ ...row, max_bid: 12347 }])[0]?.max_bid, 12347); });
  it("groups in Sydney time and excludes closed and beyond-48h lots", () => {
    const row = exampleYard(now).auctions[0]; assert.ok(row);
    const rows = [1, 24, 47, 49, -1].map(hours => ({ ...row, id: hours, closes_at: new Date(now.getTime() + hours * 3600_000).toISOString() }));
    assert.deepEqual(auctionGroups(rows, now).map(group => [group.label, group.rows.map(row => row.id)]), [["Today", [1]], ["Tomorrow", [24]], ["Next 48 hours", [47]]]);
  });
  it("links only to the existing wholesale start with encoded stock number", () => { assert.equal(wholesaleStockLink("ST 1&2"), "/portal/wholesale/start?stock_no=ST%201%262"); });
});