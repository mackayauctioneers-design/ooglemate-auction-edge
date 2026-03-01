-- ============================================================
-- Migration: Vehicle Auction History — Repeat Listing Detection
-- Tracks every time a vehicle appears at auction across all sources.
-- Enables pass number scoring: 2nd pass = +15, 3rd pass = +25
-- ============================================================

-- ============================================================
-- 1. vehicle_auction_history table
-- ============================================================
-- One row per (vehicle_fingerprint, auction_listing_id, auction_date).
-- vehicle_fingerprint = normalised make+model+year+km_band (for cars without VINs)
-- vin is stored when available for exact matching.

CREATE TABLE IF NOT EXISTS public.vehicle_auction_history (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vehicle identity (at least one of vin or fingerprint must be set)
  vin                   text,                          -- VIN when available
  fingerprint           text NOT NULL,                 -- make|model|year_band|km_band e.g. "toyota|rav4|2019-2021|70k-90k"

  -- Listing details for this appearance
  listing_id            text NOT NULL,                 -- vehicle_listings.id or external lot ID
  source                text NOT NULL,                 -- 'pickles' | 'grays' | 'manheim' | 'fowles' | 'dealer'
  auction_house         text,                          -- human-readable auction house name
  listing_url           text,
  guide_price           numeric,                       -- guide price at this appearance
  reserve_status        text,                          -- 'no_reserve' | 'reserve_met' | 'reserve_not_met' | 'unknown'
  sale_close_at         timestamptz,                   -- when this lot closes/closed
  sale_status           text,                          -- 'active' | 'sold' | 'withdrawn' | 'passed_in'
  sold_price            numeric,                       -- final hammer price if sold
  buy_method            text,                          -- 'auction' | 'buy_now' | 'make_offer'

  -- Vehicle details at time of listing
  make                  text,
  model                 text,
  year                  int,
  odometer              int,
  colour                text,
  state                 text,
  wovr_indicator        boolean DEFAULT false,
  damage_noted          boolean DEFAULT false,
  condition_notes       text[],

  -- Pass tracking (computed on insert by trigger)
  pass_number           int NOT NULL DEFAULT 1,        -- 1 = first time seen, 2 = second pass, etc.
  first_seen_at         timestamptz NOT NULL DEFAULT now(),  -- when this fingerprint was first ever seen
  days_circulating      int GENERATED ALWAYS AS (
    EXTRACT(DAY FROM (sale_close_at - first_seen_at))::int
  ) STORED,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicate entries for the same listing appearance
  UNIQUE (listing_id, source)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_vah_fingerprint ON public.vehicle_auction_history(fingerprint);
CREATE INDEX IF NOT EXISTS idx_vah_vin ON public.vehicle_auction_history(vin) WHERE vin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vah_pass_number ON public.vehicle_auction_history(pass_number);
CREATE INDEX IF NOT EXISTS idx_vah_source ON public.vehicle_auction_history(source);
CREATE INDEX IF NOT EXISTS idx_vah_sale_close ON public.vehicle_auction_history(sale_close_at);
CREATE INDEX IF NOT EXISTS idx_vah_created ON public.vehicle_auction_history(created_at DESC);

-- ============================================================
-- 2. Function: compute_vehicle_fingerprint
-- Normalises vehicle attributes into a consistent fingerprint string.
-- Used for matching cars without VINs across auction appearances.
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_vehicle_fingerprint(
  p_make      text,
  p_model     text,
  p_year      int,
  p_odometer  int
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(
    coalesce(p_make, 'unknown') || '|' ||
    coalesce(p_model, 'unknown') || '|' ||
    -- Year band: group into 2-year bands
    (((p_year / 2) * 2)::text || '-' || (((p_year / 2) * 2) + 1)::text) || '|' ||
    -- KM band: group into 20k bands
    (((p_odometer / 20000) * 20000)::text || 'k-' || (((p_odometer / 20000) * 20000) + 20000)::text || 'k')
  )
$$;

-- ============================================================
-- 3. Function: get_pass_number
-- Returns the pass number for a given vehicle fingerprint or VIN.
-- Pass 1 = first time seen, Pass 2 = second appearance, etc.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_pass_number(
  p_vin         text,
  p_fingerprint text,
  p_listing_id  text,
  p_source      text
) RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  -- Count prior appearances (excluding this listing_id)
  IF p_vin IS NOT NULL AND p_vin != '' THEN
    SELECT COUNT(*) INTO v_count
    FROM public.vehicle_auction_history
    WHERE vin = p_vin
      AND NOT (listing_id = p_listing_id AND source = p_source);
  ELSE
    SELECT COUNT(*) INTO v_count
    FROM public.vehicle_auction_history
    WHERE fingerprint = p_fingerprint
      AND NOT (listing_id = p_listing_id AND source = p_source);
  END IF;

  RETURN v_count + 1;
END;
$$;

-- ============================================================
-- 4. Function: get_first_seen_at
-- Returns the earliest first_seen_at for a fingerprint/VIN.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_first_seen_at(
  p_vin         text,
  p_fingerprint text
) RETURNS timestamptz
LANGUAGE plpgsql
AS $$
DECLARE
  v_first_seen timestamptz;
BEGIN
  IF p_vin IS NOT NULL AND p_vin != '' THEN
    SELECT MIN(created_at) INTO v_first_seen
    FROM public.vehicle_auction_history
    WHERE vin = p_vin;
  ELSE
    SELECT MIN(created_at) INTO v_first_seen
    FROM public.vehicle_auction_history
    WHERE fingerprint = p_fingerprint;
  END IF;

  RETURN COALESCE(v_first_seen, now());
END;
$$;

-- ============================================================
-- 5. Add auction history columns to vehicle_listings
-- These are denormalised for fast scoring without joins.
-- ============================================================
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS auction_pass_number    int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS auction_first_seen_at  timestamptz,
  ADD COLUMN IF NOT EXISTS auction_days_circulating int,
  ADD COLUMN IF NOT EXISTS auction_history_count  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vehicle_fingerprint    text;

-- ============================================================
-- 6. Add pass_number scoring columns to morning_brief_items
-- ============================================================
ALTER TABLE public.morning_brief_items
  ADD COLUMN IF NOT EXISTS auction_pass_number    int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS auction_first_seen_at  timestamptz,
  ADD COLUMN IF NOT EXISTS auction_days_circulating int,
  ADD COLUMN IF NOT EXISTS pass_score_bonus       int NOT NULL DEFAULT 0;

-- ============================================================
-- 7. RLS
-- ============================================================
ALTER TABLE public.vehicle_auction_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can read auction history"
  ON public.vehicle_auction_history FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role can manage auction history"
  ON public.vehicle_auction_history FOR ALL TO service_role
  USING (true);

-- ============================================================
-- 8. Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_auction_history;
