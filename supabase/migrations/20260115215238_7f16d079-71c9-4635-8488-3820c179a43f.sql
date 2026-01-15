
-- ============================================================================
-- OFF-MARKET EVENT LAYER V1 (fixed)
-- ============================================================================

-- 1) Add geo enrichment columns to retail_listings
ALTER TABLE public.retail_listings 
ADD COLUMN IF NOT EXISTS lat double precision,
ADD COLUMN IF NOT EXISTS lng double precision,
ADD COLUMN IF NOT EXISTS sa2 text,
ADD COLUMN IF NOT EXISTS sa3 text,
ADD COLUMN IF NOT EXISTS sa4 text,
ADD COLUMN IF NOT EXISTS lga text,
ADD COLUMN IF NOT EXISTS region_raw text;

-- 2) Create retail_listing_events table (append-only event log for heatmaps)
CREATE TABLE IF NOT EXISTS public.retail_listing_events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  source text NOT NULL,
  source_listing_id text NOT NULL,
  listing_id uuid NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  event_date date NOT NULL DEFAULT CURRENT_DATE,  -- For dedup, stored not computed
  run_id uuid NULL,
  -- Vehicle attributes
  make text,
  model text,
  year integer,
  price integer,
  days_live integer,
  -- Geo snapshot (frozen at event time)
  state text,
  suburb text,
  postcode text,
  lat double precision,
  lng double precision,
  sa2 text,
  sa3 text,
  sa4 text,
  lga text,
  -- Extensibility
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Unique constraint using stored date column
  UNIQUE (event_type, source, source_listing_id, event_date)
);

-- Indexes for heatmap queries
CREATE INDEX IF NOT EXISTS idx_retail_listing_events_type_at 
ON public.retail_listing_events (event_type, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_retail_listing_events_sa2_at 
ON public.retail_listing_events (sa2, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_retail_listing_events_make_model_at 
ON public.retail_listing_events (make, model, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_retail_listing_events_state_at
ON public.retail_listing_events (state, event_at DESC);

-- Enable RLS
ALTER TABLE public.retail_listing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on retail_listing_events"
ON public.retail_listing_events
FOR ALL
USING (true)
WITH CHECK (true);

-- 3) Replace mark_listings_delisted to emit DELISTED events
CREATE OR REPLACE FUNCTION public.mark_listings_delisted(
  p_source text,
  p_stale_interval interval DEFAULT '3 days'::interval
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  affected_count integer;
BEGIN
  -- First, insert DELISTED events for all listings being marked stale
  INSERT INTO public.retail_listing_events (
    event_type,
    source,
    source_listing_id,
    listing_id,
    event_at,
    event_date,
    make,
    model,
    year,
    price,
    days_live,
    state,
    suburb,
    postcode,
    lat,
    lng,
    sa2,
    sa3,
    sa4,
    lga,
    meta
  )
  SELECT 
    'DELISTED',
    rl.source,
    rl.source_listing_id,
    rl.id,
    now(),
    CURRENT_DATE,
    rl.make,
    rl.model,
    rl.year,
    rl.price,
    EXTRACT(DAY FROM (now() - rl.first_seen_at))::integer,
    rl.state,
    rl.suburb,
    rl.postcode,
    rl.lat,
    rl.lng,
    rl.sa2,
    rl.sa3,
    rl.sa4,
    rl.lga,
    jsonb_build_object(
      'first_seen_at', rl.first_seen_at,
      'last_seen_at', rl.last_seen_at,
      'times_seen', rl.times_seen
    )
  FROM public.retail_listings rl
  WHERE rl.source = p_source
    AND rl.lifecycle_status = 'ACTIVE'
    AND rl.last_seen_at < (now() - p_stale_interval)
  ON CONFLICT (event_type, source, source_listing_id, event_date) 
  DO NOTHING;

  -- Then mark the listings as delisted
  UPDATE public.retail_listings
  SET 
    lifecycle_status = 'DELISTED',
    delisted_at = now()
  WHERE source = p_source
    AND lifecycle_status = 'ACTIVE'
    AND last_seen_at < (now() - p_stale_interval);

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN affected_count;
END;
$$;

-- 4) Create view for off-market heatmap counts by state/suburb (last 30 days)
CREATE OR REPLACE VIEW public.offmarket_heatmap_30d AS
SELECT 
  state,
  suburb,
  sa2,
  sa3,
  lga,
  make,
  model,
  COUNT(*) as delist_count,
  AVG(days_live)::numeric(10,1) as avg_days_live,
  MIN(event_at) as earliest_delist,
  MAX(event_at) as latest_delist
FROM public.retail_listing_events
WHERE event_type = 'DELISTED'
  AND event_at >= now() - interval '30 days'
GROUP BY state, suburb, sa2, sa3, lga, make, model
ORDER BY delist_count DESC;

-- 5) Create view for model strength by region (weekly rollup)
CREATE OR REPLACE VIEW public.model_strength_by_region AS
SELECT 
  state,
  sa3,
  make,
  model,
  COUNT(*) as total_delists,
  COUNT(*) FILTER (WHERE event_at >= now() - interval '7 days') as delists_last_7d,
  COUNT(*) FILTER (WHERE event_at >= now() - interval '30 days') as delists_last_30d,
  AVG(days_live)::numeric(10,1) as avg_days_live,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_live) as median_days_live,
  AVG(price)::integer as avg_price
FROM public.retail_listing_events
WHERE event_type = 'DELISTED'
  AND event_at >= now() - interval '90 days'
GROUP BY state, sa3, make, model
HAVING COUNT(*) >= 3
ORDER BY delists_last_7d DESC, total_delists DESC;

COMMENT ON TABLE public.retail_listing_events IS 'Append-only event log for retail listings. Used for geo-liquidity heatmaps and off-market analysis.';
COMMENT ON VIEW public.offmarket_heatmap_30d IS 'Off-market counts by geo + make/model for last 30 days. Use for heatmaps.';
COMMENT ON VIEW public.model_strength_by_region IS 'Model turnover velocity by region. Higher delists_last_7d = faster moving.';
