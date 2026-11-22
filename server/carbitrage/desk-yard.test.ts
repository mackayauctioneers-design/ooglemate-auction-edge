import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auctionGroups, auctionsSchema, countdown, exampleYard, floorMoved, sortStock, stockGap, stockSchema, wholesaleStockLink, yardMoney } from "../../src/portal/desk/yardData.ts";

const liveStock = { stock_id: "redacted-stock", stock_no: null, year: 2020, make: "Mazda", model: "CX-8", badge: "Sport (AWD)", km: 151314, days_in_stock: 16, stage: "Good", asking_price: null, asking_gap: null, buy_price: 11500, floor: 22800, no_floor: false, floor_km: 101168, floor_car_url: "https://example.com/floor", comp_count: 46, next_comps: [{ year: 2021, km: 82752, price: 21345, url: "https://example.com/comp" }], cost_gap: -11300, floor_moved: "same", floor_first: 22800 };
const liveAuction = { auction_house: "Grays", lot: "redacted-lot", url: "https://example.com/lot", title: "2010 Holden Commodore SV6 Petrol", year: 2010, make: "Holden", model: "Commodore", km: 238224, state: "VIC", closes_at: "2026-11-22T20:00+11:00", closes_in_min: 88, group: "Today", current_bid: 1000, floor: null, no_floor: true, comp_count: null, max_bid: null, max_bid_basis: null, reason: "You've sold 4 Commodore.", under_floor_label: false };
const stockBody = (items: unknown[], money_hidden = false) => ({ count: items.length, role: "owner", money_hidden, items });
const auctionBody = (Today: unknown[], Tomorrow: unknown[] = [], money_hidden = false) => ({ count: Today.length + Tomorrow.length, role: "owner", money_hidden, groups: { Today, Tomorrow } });

describe("confirmed stock and auction feed display rules", () => {
  const now = new Date("2026-11-22T07:26:00Z");
  const stock = exampleYard(now).stock;
  const first = stock[0];
  if (!first) throw new Error("Missing fixture");
  it("accepts the stock sample with null stock number and minimal comparables", () => {
    const row = stockSchema.parse(stockBody([liveStock]))[0];
    assert.equal(row?.stock_no, null); assert.equal(row?.stock_id, "redacted-stock");
    assert.equal(row?.floor, 22800); assert.equal(row?.next_comps?.[0]?.price, 21345); assert.equal(row?.next_comps?.[0]?.url, "https://example.com/comp");
  });
  it("preserves server stages without recalculating thresholds", () => { assert.equal(stockSchema.parse(stockBody([{ ...liveStock, days_in_stock: 5, stage: "Exit" }]))[0]?.stage, "Exit"); });
  it("orders needs action by Exit, Act, Watch, Good before prices", () => {
    assert.deepEqual(sortStock(stock.map(row => ({ ...row, cost_gap: row.stage === "Good" ? 999999 : -11300 })), "action").map(row => row.stage), ["Exit", "Act", "Watch", "Good"]);
  });
  it("sorts within a stage by cost gap high to low then days descending", () => {
    assert.deepEqual(sortStock([{ ...first, stock_no: "older", cost_gap: 800, days_in_stock: 110 }, { ...first, stock_no: "over", cost_gap: 2100, days_in_stock: 10 }, { ...first, stock_no: "younger", cost_gap: 800, days_in_stock: 30 }], "action").map(row => row.stock_no), ["over", "older", "younger"]);
  });
  it("oldest ordering ignores stage and gap", () => { assert.deepEqual(sortStock([{ ...first, stock_no: "young", stage: "Exit", days_in_stock: 10, cost_gap: 5000 }, { ...first, stock_no: "old", stage: "Good", days_in_stock: 110, cost_gap: -800 }], "oldest").map(row => row.stock_no), ["old", "young"]); });
  it("never calculates missing cost gaps from prices", () => { assert.equal(stockGap({ ...first, cost_gap: undefined }), ""); assert.equal(stockGap({ ...first, buy_price: 1, floor: 99999, cost_gap: 2100 }), "$2.1k over floor"); });
  it("formats confirmed cost gap independently of null asking price", () => { const row = stockSchema.parse(stockBody([liveStock]))[0]; assert.ok(row); assert.equal(stockGap(row), "$11.3k under floor"); });
  it("only formats asking gap when the API supplies it", () => { assert.equal(stockGap({ ...first, asking_gap: null }, "asking_gap"), ""); assert.equal(stockGap({ ...first, asking_price: 1, floor: 99999, asking_gap: 2100 }, "asking_gap"), "$2.1k over floor"); });
  it("suppresses floors, cost gaps and comparables when no_floor is true", () => { const row = stockSchema.parse(stockBody([{ ...liveStock, no_floor: true }]))[0]; assert.equal(row?.floor, null); assert.equal(row?.cost_gap, null); assert.equal(row?.next_comps, null); assert.ok(row); assert.equal(stockGap(row), ""); });
  it("accepts explicit null comparable list when floor is unavailable", () => { assert.equal(stockSchema.parse(stockBody([{ ...liveStock, no_floor: true, next_comps: null }]))[0]?.next_comps, null); });
  it("only marks a floor move when non-null and not same", () => { assert.equal(floorMoved(null), false); assert.equal(floorMoved("same"), false); assert.equal(floorMoved("-500"), true); assert.equal(floorMoved("up"), true); });
  it("keeps omitted money blank", () => { assert.equal(yardMoney(undefined), ""); assert.equal(yardMoney(null), ""); });
  it("honours stock money_hidden even if numbers are accidentally supplied", () => { const row = stockSchema.parse(stockBody([liveStock], true))[0]; assert.equal(row?.buy_price, null); assert.equal(row?.floor, null); assert.equal(row?.cost_gap, null); assert.equal(row?.next_comps?.[0]?.price, null); });
  it("accepts the grouped auction sample and minute-precision closing time", () => { const row = auctionsSchema.parse(auctionBody([liveAuction])).Today[0]; assert.equal(row?.current_bid, 1000); assert.equal(row?.closes_at, "2026-11-22T20:00+11:00"); assert.equal(row?.url, "https://example.com/lot"); });
  it("preserves server Today and Tomorrow groups regardless of closing dates", () => { const feed = auctionsSchema.parse(auctionBody([{ ...liveAuction, closes_at: "2026-12-01T20:00+11:00" }], [{ ...liveAuction, lot: "tomorrow", closes_at: "2026-11-21T20:00+11:00" }])); assert.deepEqual(auctionGroups(feed).map(group => [group.label, group.rows.map(row => row.lot)]), [["Today", ["redacted-lot"]], ["Tomorrow", ["tomorrow"]]]); });
  it("counts down from closes_at, not supplied closes_in_min", () => { assert.equal(countdown(liveAuction.closes_at, new Date("2026-11-22T08:20:00Z")), "0h 40m left"); });
  it("keeps floor, max bid and basis exactly as supplied", () => { const row = auctionsSchema.parse(auctionBody([{ ...liveAuction, no_floor: false, floor: 22800, max_bid: 12347, max_bid_basis: "Sales truth" }])).Today[0]; assert.equal(row?.floor, 22800); assert.equal(row?.max_bid, 12347); assert.equal(row?.max_bid_basis, "Sales truth"); });
  it("does not infer under floor from bid and floor prices", () => { const row = auctionsSchema.parse(auctionBody([{ ...liveAuction, no_floor: false, floor: 22800, under_floor_label: false }])).Today[0]; assert.equal(row?.under_floor_label, false); assert.equal(auctionsSchema.parse(auctionBody([{ ...liveAuction, no_floor: false, under_floor_label: true }])).Today[0]?.under_floor_label, true); });
  it("protects auction floors and limits when no_floor is true", () => { const row = auctionsSchema.parse(auctionBody([{ ...liveAuction, floor: 22800, max_bid: 12347, max_bid_basis: "Sales truth", under_floor_label: true }])).Today[0]; assert.equal(row?.floor, null); assert.equal(row?.max_bid, null); assert.equal(row?.max_bid_basis, null); assert.equal(row?.under_floor_label, false); });
  it("honours auction money_hidden", () => { const row = auctionsSchema.parse(auctionBody([{ ...liveAuction, no_floor: false, floor: 22800, max_bid: 12347, under_floor_label: true }], [], true)).Today[0]; assert.equal(row?.current_bid, null); assert.equal(row?.max_bid, null); assert.equal(row?.floor, null); assert.equal(row?.under_floor_label, false); });
  it("strips other dealer identity, stock and prices from auctions", () => { const row = auctionsSchema.parse(auctionBody([{ ...liveAuction, dealer_name: "Other dealer", stock_no: "SECRET", dealer_price: 123 }])).Today[0]; assert.equal("dealer_name" in (row ?? {}), false); assert.equal("stock_no" in (row ?? {}), false); assert.equal("dealer_price" in (row ?? {}), false); });
  it("links only to the existing wholesale start with encoded stock number", () => { assert.equal(wholesaleStockLink("ST 1&2"), "/portal/wholesale/start?stock_no=ST%201%262"); });
});
