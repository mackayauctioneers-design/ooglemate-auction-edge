-- ============================================================================
-- GEO-LIQUIDITY WEIGHTED HEAT DETECTION SCHEMA
-- Adapts to existing vehicle_listings table
-- ============================================================================

-- Add seller_type to vehicle_listings (default 'dealer' for auction sources)
ALTER TABLE public.vehicle_listings 
ADD COLUMN IF NOT EXISTS seller_type text NOT NULL DEFAULT 'dealer';

-- ============================================================================
-- CLEARANCE EVENTS - Stores derived outcomes (TTD)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.clearance_events (
  id bigserial PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  cleared_at timestamptz NOT NULL,
  clearance_type text NOT NULL,  -- removed|sold|passed_in|relisted
  days_to_clear numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, clearance_type, cleared_at)
);

-- Enable RLS
ALTER TABLE public.clearance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view clearance events"
ON public.clearance_events FOR SELECT USING (true);

CREATE POLICY "Service can manage clearance events"
ON public.clearance_events FOR ALL USING (true) WITH CHECK (true);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_clearance_events_cleared_at 
ON public.clearance_events(cleared_at);

CREATE INDEX IF NOT EXISTS idx_clearance_events_listing_id 
ON public.clearance_events(listing_id);

-- ============================================================================
-- GEO MODEL METRICS DAILY - Daily rollups for heatmaps + alerts
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.geo_model_metrics_daily (
  metric_date date NOT NULL,
  region_id text NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  variant_bucket text NOT NULL DEFAULT 'ALL',
  w_avg_days_to_clear numeric,
  w_relist_rate numeric,
  w_clear_count numeric,
  w_listing_count numeric,
  w_dealer_share numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_date, region_id, make, model, variant_bucket)
);

-- Enable RLS
ALTER TABLE public.geo_model_metrics_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view geo metrics"
ON public.geo_model_metrics_daily FOR SELECT USING (true);

CREATE POLICY "Service can manage geo metrics"
ON public.geo_model_metrics_daily FOR ALL USING (true) WITH CHECK (true);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_geo_metrics_region_make_model 
ON public.geo_model_metrics_daily(region_id, make, model);

CREATE INDEX IF NOT EXISTS idx_geo_metrics_date 
ON public.geo_model_metrics_daily(metric_date DESC);

-- ============================================================================
-- GEO HEAT ALERTS - Stores detected heat/cooling alerts
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.geo_heat_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  asof_date date NOT NULL,
  audience text NOT NULL DEFAULT 'internal',  -- internal|dealer
  tier text NOT NULL,  -- EARLY_PRIVATE_LED|CONFIRMED_DEALER_VALIDATED|COOLING
  status text NOT NULL DEFAULT 'active',  -- active|acknowledged|expired
  feature_key text NOT NULL DEFAULT 'geo_liquidity',
  region_id text NOT NULL,
  region_label text,
  make text NOT NULL,
  model text NOT NULL,
  variant_bucket text NOT NULL DEFAULT 'ALL',
  year_min int,
  metric_type text NOT NULL DEFAULT 'TTD',
  value_short numeric,
  value_long numeric,
  pct_change numeric,
  sample_short numeric,
  dealer_share_short numeric,
  relist_rate_short numeric,
  confidence text,  -- HIGH|MED|LOW
  title text,
  subtitle text,
  tagline text,
  acknowledged_at timestamptz,
  expired_at timestamptz
);

-- Enable RLS
ALTER TABLE public.geo_heat_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view geo heat alerts"
ON public.geo_heat_alerts FOR SELECT USING (true);

CREATE POLICY "Service can manage geo heat alerts"
ON public.geo_heat_alerts FOR ALL USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_geo_heat_alerts_status 
ON public.geo_heat_alerts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_geo_heat_alerts_region 
ON public.geo_heat_alerts(region_id, make, model);

-- ============================================================================
-- HELPER FUNCTION: Seller weight (Dealer=1.0, Private/Unknown=0.4)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.seller_weight(p_seller_type text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_seller_type,'')) = 'dealer' THEN 1.0
    ELSE 0.4
  END;
$$;

-- ============================================================================
-- HELPER FUNCTION: Map location string to region_id (Australian state)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.location_to_region(p_location text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(coalesce(p_location,'')) ~ '\y(nsw|new south wales|sydney|penrith|milperra)\y' THEN 'NSW'
    WHEN lower(coalesce(p_location,'')) ~ '\y(vic|victoria|melbourne|laverton|dandenong)\y' THEN 'VIC'
    WHEN lower(coalesce(p_location,'')) ~ '\y(qld|queensland|brisbane|gold coast|townsville|cairns|yatala|rockhampton|toowoomba|mackay)\y' THEN 'QLD'
    WHEN lower(coalesce(p_location,'')) ~ '\y(sa|south australia|adelaide|lonsdale)\y' THEN 'SA'
    WHEN lower(coalesce(p_location,'')) ~ '\y(wa|western australia|perth|canning vale|belmont)\y' THEN 'WA'
    WHEN lower(coalesce(p_location,'')) ~ '\y(tas|tasmania|hobart)\y' THEN 'TAS'
    WHEN lower(coalesce(p_location,'')) ~ '\y(nt|northern territory|darwin)\y' THEN 'NT'
    WHEN lower(coalesce(p_location,'')) ~ '\y(act|canberra)\y' THEN 'ACT'
    ELSE 'UNKNOWN'
  END;
$$;

-- ============================================================================
-- FUNCTION: Derive clearance events from stale listings
-- ============================================================================
CREATE OR REPLACE FUNCTION public.derive_clearance_events(p_stale_hours int DEFAULT 36)
RETURNS TABLE(listings_processed int, events_created int)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_processed int := 0;
  v_created int := 0;
BEGIN
  -- Find stale active listings and create clearance events
  WITH stale AS (
    SELECT l.id, l.last_seen_at, l.first_seen_at, l.status,
           CASE 
             WHEN l.relist_count > 0 THEN 'relisted'
             WHEN l.pass_count > 0 THEN 'passed_in'
             ELSE 'removed'
           END as derived_type
    FROM vehicle_listings l
    WHERE l.status IN ('catalogue', 'listed', 'active')
      AND l.last_seen_at < now() - make_interval(hours => p_stale_hours)
  ),
  ins AS (
    INSERT INTO clearance_events (listing_id, cleared_at, clearance_type, days_to_clear)
    SELECT
      s.id,
      s.last_seen_at,
      s.derived_type,
      GREATEST(0.1, extract(epoch from (s.last_seen_at - s.first_seen_at)) / 86400.0)
    FROM stale s
    ON CONFLICT (listing_id, clearance_type, cleared_at) DO NOTHING
    RETURNING listing_id
  )
  SELECT count(*) INTO v_created FROM ins;

  -- Update status for processed listings
  UPDATE vehicle_listings
  SET status = 'cleared', updated_at = now()
  WHERE id IN (
    SELECT id FROM vehicle_listings
    WHERE status IN ('catalogue', 'listed', 'active')
      AND last_seen_at < now() - make_interval(hours => p_stale_hours)
  );
  
  GET DIAGNOSTICS v_processed = ROW_COUNT;

  RETURN QUERY SELECT v_processed, v_created;
END;
$$;

-- ============================================================================
-- FUNCTION: Roll up daily geo/model metrics (weighted)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rollup_geo_model_metrics_daily(p_day date DEFAULT current_date)
RETURNS TABLE(regions_updated int, records_upserted int)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_regions int := 0;
  v_records int := 0;
BEGIN
  INSERT INTO geo_model_metrics_daily (
    metric_date, region_id, make, model, variant_bucket,
    w_avg_days_to_clear, w_relist_rate, w_clear_count, w_listing_count, w_dealer_share
  )
  WITH base AS (
    SELECT
      p_day as metric_date,
      location_to_region(l.location) as region_id,
      coalesce(upper(l.make), 'UNKNOWN') as make,
      coalesce(upper(l.model), 'UNKNOWN') as model,
      coalesce(l.variant_family, 'ALL') as variant_bucket,
      seller_weight(l.seller_type) as w,
      l.seller_type,
      l.relist_count > 0 as relisted,
      ce.days_to_clear,
      CASE WHEN ce.id IS NOT NULL THEN 1 ELSE 0 END as cleared_flag,
      1 as listing_flag
    FROM vehicle_listings l
    LEFT JOIN clearance_events ce
      ON ce.listing_id = l.id
     AND ce.cleared_at::date = p_day
    WHERE location_to_region(l.location) != 'UNKNOWN'
      AND l.make IS NOT NULL
      AND l.model IS NOT NULL
      AND (l.year IS NULL OR l.year >= 2016)
  ),
  agg AS (
    SELECT
      metric_date, region_id, make, model, variant_bucket,
      CASE WHEN sum(w * cleared_flag) > 0
        THEN sum(w * cleared_flag * coalesce(days_to_clear, 0)) / nullif(sum(w * cleared_flag), 0)
        ELSE NULL END as w_avg_days_to_clear,
      CASE WHEN sum(w * cleared_flag) > 0
        THEN sum(w * cleared_flag * (CASE WHEN relisted THEN 1 ELSE 0 END)) / nullif(sum(w * cleared_flag), 0)
        ELSE NULL END as w_relist_rate,
      sum(w * cleared_flag) as w_clear_count,
      sum(w * listing_flag) as w_listing_count,
      sum((CASE WHEN lower(coalesce(seller_type, '')) = 'dealer' THEN w ELSE 0 END)) / nullif(sum(w), 0) as w_dealer_share
    FROM base
    GROUP BY 1, 2, 3, 4, 5
  )
  SELECT * FROM agg
  ON CONFLICT (metric_date, region_id, make, model, variant_bucket) DO UPDATE
  SET
    w_avg_days_to_clear = excluded.w_avg_days_to_clear,
    w_relist_rate = excluded.w_relist_rate,
    w_clear_count = excluded.w_clear_count,
    w_listing_count = excluded.w_listing_count,
    w_dealer_share = excluded.w_dealer_share,
    created_at = now();

  GET DIAGNOSTICS v_records = ROW_COUNT;
  
  SELECT count(DISTINCT region_id) INTO v_regions 
  FROM geo_model_metrics_daily 
  WHERE metric_date = p_day;

  RETURN QUERY SELECT v_regions, v_records;
END;
$$;

-- ============================================================================
-- FUNCTION: Detect geo heat alerts (7d vs 28d comparison)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.detect_geo_heat_alerts(
  p_asof date DEFAULT current_date,
  p_drop_threshold numeric DEFAULT 0.30,
  p_min_sample_7d numeric DEFAULT 15.0
)
RETURNS TABLE (
  alert_tier text,
  region_id text,
  make text,
  model text,
  variant_bucket text,
  metric_type text,
  value_7d numeric,
  value_28d numeric,
  pct_change numeric,
  sample_7d numeric,
  dealer_share_7d numeric,
  confidence text
)
LANGUAGE sql
SET search_path = public
AS $$
WITH w7 AS (
  SELECT region_id, make, model, variant_bucket,
         avg(w_avg_days_to_clear) as v7,
         sum(w_clear_count) as s7,
         avg(w_dealer_share) as d7,
         avg(w_relist_rate) as r7
  FROM geo_model_metrics_daily
  WHERE metric_date BETWEEN (p_asof - interval '6 days')::date AND p_asof
  GROUP BY 1, 2, 3, 4
),
w28 AS (
  SELECT region_id, make, model, variant_bucket,
         avg(w_avg_days_to_clear) as v28,
         sum(w_clear_count) as s28,
         avg(w_dealer_share) as d28
  FROM geo_model_metrics_daily
  WHERE metric_date BETWEEN (p_asof - interval '34 days')::date AND (p_asof - interval '7 days')::date
  GROUP BY 1, 2, 3, 4
),
joined AS (
  SELECT
    w7.region_id, w7.make, w7.model, w7.variant_bucket,
    w7.v7, w28.v28, w7.s7, w7.d7, w7.r7,
    CASE WHEN w28.v28 IS NULL OR w28.v28 = 0 THEN NULL
         ELSE (w7.v7 - w28.v28) / w28.v28 END as pct_change
  FROM w7
  LEFT JOIN w28 USING (region_id, make, model, variant_bucket)
  WHERE w7.v7 IS NOT NULL
),
scored AS (
  SELECT *,
    CASE
      WHEN s7 >= 40 THEN 'HIGH'
      WHEN s7 >= 20 THEN 'MED'
      ELSE 'LOW'
    END as confidence
  FROM joined
)
SELECT
  CASE
    WHEN pct_change IS NOT NULL
      AND pct_change <= (-1 * p_drop_threshold)
      AND s7 >= p_min_sample_7d
      AND coalesce(d7, 0) < 0.50
      THEN 'EARLY_PRIVATE_LED'
    WHEN pct_change IS NOT NULL
      AND pct_change <= (-1 * p_drop_threshold)
      AND s7 >= p_min_sample_7d
      AND coalesce(d7, 0) >= 0.50
      THEN 'CONFIRMED_DEALER_VALIDATED'
    WHEN pct_change IS NOT NULL
      AND pct_change >= p_drop_threshold
      AND s7 >= p_min_sample_7d
      THEN 'COOLING'
    ELSE NULL
  END as alert_tier,
  region_id, make, model, variant_bucket,
  'TTD' as metric_type,
  v7 as value_7d,
  v28 as value_28d,
  pct_change,
  s7 as sample_7d,
  d7 as dealer_share_7d,
  confidence
FROM scored
WHERE pct_change IS NOT NULL
  AND (
    (pct_change <= (-1 * p_drop_threshold) AND s7 >= p_min_sample_7d)
    OR (pct_change >= p_drop_threshold AND s7 >= p_min_sample_7d)
  );
$$;

-- ============================================================================
-- FUNCTION: Generate and upsert heat alerts (deduped)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_geo_heat_alerts(
  p_asof date DEFAULT current_date,
  p_drop_threshold numeric DEFAULT 0.30,
  p_min_sample_7d numeric DEFAULT 15.0
)
RETURNS TABLE(alerts_created int, alerts_updated int)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_created int := 0;
  v_updated int := 0;
BEGIN
  -- Upsert detected alerts
  WITH detected AS (
    SELECT * FROM detect_geo_heat_alerts(p_asof, p_drop_threshold, p_min_sample_7d)
    WHERE alert_tier IS NOT NULL
  ),
  upserted AS (
    INSERT INTO geo_heat_alerts (
      alert_id, asof_date, tier, region_id, make, model, variant_bucket,
      metric_type, value_short, value_long, pct_change,
      sample_short, dealer_share_short, confidence,
      title, subtitle, tagline
    )
    SELECT
      md5(d.region_id || d.make || d.model || d.variant_bucket || p_asof::text) as alert_id,
      p_asof,
      d.alert_tier,
      d.region_id,
      d.make,
      d.model,
      d.variant_bucket,
      d.metric_type,
      d.value_7d,
      d.value_28d,
      d.pct_change,
      d.sample_7d,
      d.dealer_share_7d,
      d.confidence,
      d.region_id || ': ' || d.make || ' ' || d.model || 
        CASE WHEN d.pct_change < 0 THEN ' clearing faster' ELSE ' slowing down' END,
      'Median TTD ' || 
        CASE WHEN d.pct_change < 0 
          THEN 'dropped ' || abs(round(d.pct_change * 100))::text || '%'
          ELSE 'increased ' || round(d.pct_change * 100)::text || '%'
        END || ' vs baseline',
      CASE d.alert_tier
        WHEN 'EARLY_PRIVATE_LED' THEN 'EARLY (private-led). Watch for dealer confirmation.'
        WHEN 'CONFIRMED_DEALER_VALIDATED' THEN 'CONFIRMED (dealer-validated). High confidence signal.'
        WHEN 'COOLING' THEN 'COOLING. Demand may be softening.'
        ELSE ''
      END
    FROM detected d
    ON CONFLICT (alert_id) DO UPDATE SET
      tier = excluded.tier,
      value_short = excluded.value_short,
      value_long = excluded.value_long,
      pct_change = excluded.pct_change,
      sample_short = excluded.sample_short,
      dealer_share_short = excluded.dealer_share_short,
      confidence = excluded.confidence,
      title = excluded.title,
      subtitle = excluded.subtitle,
      tagline = excluded.tagline,
      status = 'active'
    RETURNING (xmax = 0) as is_insert
  )
  SELECT 
    count(*) FILTER (WHERE is_insert) as created,
    count(*) FILTER (WHERE NOT is_insert) as updated
  INTO v_created, v_updated
  FROM upserted;

  -- Expire old alerts not refreshed today
  UPDATE geo_heat_alerts
  SET status = 'expired', expired_at = now()
  WHERE status = 'active'
    AND asof_date < p_asof;

  RETURN QUERY SELECT v_created, v_updated;
END;
$$;