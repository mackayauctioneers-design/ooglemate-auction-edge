import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blankStaleAnchor, chooseBestFit, eligibleYards, expiryReason, formatAuctionEnd, isFreshSale, parseSlatteryCloses, slatteryAuctionId } from "../../supabase/functions/_shared/deskFreshness.ts";

const NOW = new Date("2026-11-25T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();

describe("120-day price anchors", () => {
  it("a sale 120 days old still prices; 121 days does not; null never", () => {
    assert.equal(isFreshSale(daysAgo(120), NOW), true);
    assert.equal(isFreshSale(daysAgo(121), NOW), false);
    assert.equal(isFreshSale(null, NOW), false);
  });
  it("blanks every anchor price field older than 120 days", () => {
    const o = blankStaleAnchor({ id: "x", anchor_sale_id: "s", anchor_sale_buy_price: 30000, anchor_sale_sell_price: 35000, anchor_sale_profit: 5000, anchor_sale_sold_at: daysAgo(200), anchor_sale_km: 1, anchor_sale_trim_class: "SR5" }, NOW);
    for (const k of ["anchor_sale_id", "anchor_sale_buy_price", "anchor_sale_sell_price", "anchor_sale_profit", "anchor_sale_sold_at", "anchor_sale_km", "anchor_sale_trim_class"]) assert.equal((o as any)[k], null, k);
    assert.equal(o.anchor_trend_only, true);
  });
  it("blanks an anchor with no sold date", () => { assert.equal(blankStaleAnchor({ anchor_sale_buy_price: 1, anchor_sale_sold_at: null }, NOW).anchor_sale_buy_price, null); });
  it("keeps a fresh anchor untouched", () => { assert.equal(blankStaleAnchor({ anchor_sale_buy_price: 30000, anchor_sale_sold_at: daysAgo(30) }, NOW).anchor_sale_buy_price, 30000); });
  it("scorer anchor pool keeps only own sales <=120 days", () => {
    const sales = [{ id: "a", sold_at: daysAgo(5) }, { id: "b", sold_at: daysAgo(300) }, { id: "c", sold_at: daysAgo(119) }];
    assert.deepEqual(sales.filter((s) => isFreshSale(s.sold_at, NOW)).map((s) => s.id), ["a", "c"]);
  });
});

describe("best fit needs own sales in the last 120 days", () => {
  const sales = { mackay: [{ sold_at: daysAgo(3) }], hardy: [{ sold_at: daysAgo(299) }], patrick: [{ sold_at: daysAgo(194) }], ajh: [{ sold_at: daysAgo(60) }, { sold_at: daysAgo(400) }] };
  it("Hardy- and Patrick-like yards are not eligible", () => { assert.deepEqual([...eligibleYards(sales, NOW)].sort(), ["ajh", "mackay"]); });
  it("falls through to the next eligible yard", () => {
    const r = chooseBestFit([{ account_id: "hardy" }, { account_id: "ajh" }, { account_id: "patrick" }], eligibleYards(sales, NOW));
    assert.equal(r.best?.account_id, "ajh"); assert.deepEqual(r.alts.map((m) => m.account_id), ["hardy", "patrick"]);
  });
  it("no eligible yard => no best fit", () => { assert.equal(chooseBestFit([{ account_id: "hardy" }], eligibleYards(sales, NOW)).best, null); });
});

describe("auction expiry", () => {
  it("auction end in the past => expired", () => { assert.equal(expiryReason({ auction_datetime: daysAgo(0.1) }, undefined, NOW), "auction_ended"); });
  it("end taken from the listing when the desk row has none", () => { assert.equal(expiryReason({}, { status: "active", auction_datetime: daysAgo(0.1), last_seen_at: NOW.toISOString() }, NOW), "auction_ended"); });
  it("future end, fresh active listing => kept", () => { assert.equal(expiryReason({ listing_source: "slattery", auction_datetime: daysAgo(-1) }, { status: "active", last_seen_at: daysAgo(0.5) }, NOW), null); });
  it("source not active/catalogue => gone", () => { assert.equal(expiryReason({}, { status: "sold" }, NOW), "source_gone"); });
  it("sold_detected_at set => gone", () => { assert.equal(expiryReason({}, { status: "active", sold_detected_at: daysAgo(1) }, NOW), "source_gone"); });
  it("daily auction source unseen >36h => stale; retail source not judged by age", () => {
    assert.equal(expiryReason({ listing_source: "manheim" }, { status: "catalogue", last_seen_at: daysAgo(1.6) }, NOW), "source_stale");
    assert.equal(expiryReason({ listing_source: "autotrader" }, { status: "active", last_seen_at: daysAgo(3) }, NOW), null);
  });
});

describe("Sydney end time", () => {
  it("formats in Sydney daylight time (Wed 25 Nov 2026)", () => { assert.equal(formatAuctionEnd("2026-09-01T08:30:00Z"), "Ends Tue 1 Sep 6:30pm"); assert.equal(formatAuctionEnd("2026-11-25T08:30:00Z"), "Ends Wed 25 Nov 7:30pm"); });
  it("crosses midnight into the Sydney day", () => { assert.equal(formatAuctionEnd("2026-11-24T22:05:00Z"), "Ends Wed 25 Nov 9:05am"); });
  it("winter (AEST) offset", () => { assert.equal(formatAuctionEnd("2026-06-15T09:00:00Z"), "Ends Mon 15 Jun 7:00pm"); });
  it("null for missing", () => { assert.equal(formatAuctionEnd(null), null); });
});

describe("Slattery end-time lookup", () => {
  it("reads auctionId from the lot URL", () => { assert.equal(slatteryAuctionId("https://slatteryauctions.com.au/assets/152504?auctionId=13597"), "13597"); });
  it("maps asset ids to closesAt from an auction page", () => {
    const html = String.raw`{\"id\":152504,\"lotNumber\":2,\"opensAt\":\"2026-11-20T06:00:00Z\",\"closesAt\":\"2026-11-24T08:02:00Z\"},{\"id\":152509,\"closesAt\":\"2026-11-24T08:13:48Z\"}`;
    const r = parseSlatteryCloses(html);
    assert.equal(r.byAsset["152504"], "2026-11-24T08:02:00Z"); assert.equal(r.latest, "2026-11-24T08:13:48Z");
  });
});
