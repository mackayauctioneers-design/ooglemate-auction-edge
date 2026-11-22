import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const count = z.number().int().nonnegative();
const optionalCount = count.nullable();
export const LISTING_STATS_REFRESH_MS = 10 * 60 * 1000;
export const listingStatsSchema = z.object({
  total_live_listings: count,
  retail_dealer_listings: count,
  auction_lots_open: count,
  added_last_24h: count,
  last_updated: z.string().datetime({ offset: true }),
  by_source: z.object({
    carsales: optionalCount, autotrader: optionalCount, gumtree_dealer: optionalCount,
    dealer_sites: optionalCount, other_portals: optionalCount,
    auctions: z.object({ pickles: optionalCount, grays: optionalCount, slattery: optionalCount,
      auto_auctions: optionalCount, united_auctions: optionalCount, manheim: optionalCount }),
  }),
  by_state: z.record(optionalCount),
  top_makes: z.array(z.object({ make: z.string(), count })),
  by_year_band: z.object({ "2020_plus": count, older: count, unknown: count }),
  wholesale_price_points: z.object({ total: count, auction_bid_observations: count }),
  valuations_run: z.object({ total: count, market_searches_total: count }),
});

export function useListingStats() {
  return useQuery({
    queryKey: ["public-listing-stats"],
    queryFn: async ({ signal }) => {
      const response = await fetch("https://srv1422435.hstgr.cloud/api/carbitrage/public/listing-stats", { signal, credentials: "omit" });
      if (!response.ok) throw new Error("Live figures temporarily unavailable");
      return listingStatsSchema.parse(await response.json());
    },
    staleTime: LISTING_STATS_REFRESH_MS,
    refetchInterval: LISTING_STATS_REFRESH_MS,
    refetchIntervalInBackground: true,
    retry: 1,
  });
}