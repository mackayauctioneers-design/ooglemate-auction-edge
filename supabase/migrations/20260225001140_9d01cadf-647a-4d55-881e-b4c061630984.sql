-- 1. Drop the FK from pickles_buy_now_listings to dealer_liquidity_profiles
-- Profiles are rebuildable/volatile — they should never be a hard FK target
ALTER TABLE public.pickles_buy_now_listings
  DROP CONSTRAINT IF EXISTS pickles_buy_now_listings_matched_profile_id_fkey;

-- 2. Add a natural key column so downstream can re-resolve profiles without FK
-- (dealer_key + make + model + badge + km_band is the stable composite key)
-- The matched_profile_id column stays as a nullable soft reference for convenience