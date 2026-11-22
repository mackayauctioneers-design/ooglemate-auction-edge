import assert from "node:assert/strict";
import test from "node:test";
import { LISTING_STATS_REFRESH_MS, listingStatsSchema } from "./useListingStats.ts";

test("public figures refresh every ten minutes", () => {
  assert.equal(LISTING_STATS_REFRESH_MS, 600000);
});

test("aggregate schema excludes vehicle identifiers and dealer identities", () => {
  const aggregate = {
    total_live_listings: 100, retail_dealer_listings: 90, auction_lots_open: 10,
    added_last_24h: 5, last_updated: "2026-11-22T12:02:04+11:00",
    by_source: { carsales: 90, autotrader: 0, gumtree_dealer: null, dealer_sites: 0,
      other_portals: 0, auctions: { pickles: 10, grays: 0, slattery: 0,
        auto_auctions: 0, united_auctions: 0, manheim: null } },
    by_state: { NSW: 75, unknown: 25 }, top_makes: [{ make: "Toyota", count: 50 }],
    by_year_band: { "2020_plus": 89, older: 10, unknown: 1 },
    wholesale_price_points: { total: 20, auction_bid_observations: 1000 },
    valuations_run: { total: 1, market_searches_total: 2 },
    vin: "private-vin", rego: "private-rego", dealer_name: "private-dealer", ad_url: "private-ad",
  };
  const parsed = listingStatsSchema.parse(aggregate);
  for (const field of ["vin", "rego", "dealer_name", "ad_url"]) assert.equal(field in parsed, false);
});