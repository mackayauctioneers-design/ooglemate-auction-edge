-- Fix Issue 1: Remove dangerous default on auction_house column
ALTER TABLE public.vehicle_listings ALTER COLUMN auction_house DROP DEFAULT;

-- Backfill: Clear auction_house on all non-auction sources
UPDATE public.vehicle_listings
SET auction_house = NULL
WHERE source NOT IN ('pickles', 'pickles_crawl', 'manheim', 'auto_auctions', 'auto_auctions_aav', 'f3', 'slattery', 'uaa_nsw', 'grays')
  AND auction_house IS NOT NULL;