-- 1) Drop and recreate views with correct source prefix (dealer_site:)

DROP VIEW IF EXISTS public.trap_deals_90_plus CASCADE;
DROP VIEW IF EXISTS public.trap_deals CASCADE;
DROP VIEW IF EXISTS public.trap_inventory_current CASCADE;
DROP VIEW IF EXISTS public.fingerprint_outcomes_latest CASCADE;

-- A) fingerprint_outcomes_latest: pick the latest asof_date per fingerprint key
CREATE VIEW public.fingerprint_outcomes_latest AS
SELECT fo.*
FROM public.fingerprint_outcomes fo
JOIN (
  SELECT
    region_id, make, model, variant_family,
    year_min, year_max, km_band_min, km_band_max,
    fuel, transmission,
    max(asof_date) as max_asof_date
  FROM public.fingerprint_outcomes
  GROUP BY 1,2,3,4,5,6,7,8,9,10
) x
ON x.region_id = fo.region_id
AND x.make = fo.make
AND x.model = fo.model
AND x.variant_family = fo.variant_family
AND x.year_min = fo.year_min
AND x.year_max = fo.year_max
AND x.km_band_min = fo.km_band_min
AND x.km_band_max = fo.km_band_max
AND x.fuel = fo.fuel
AND x.transmission = fo.transmission
AND x.max_asof_date = fo.asof_date;

-- B) trap_inventory_current: latest price + time on market (FIXED: dealer_site: prefix)
CREATE VIEW public.trap_inventory_current AS
WITH latest_snap AS (
  SELECT
    ls.listing_id,
    ls.seen_at,
    ls.asking_price,
    row_number() OVER (PARTITION BY ls.listing_id ORDER BY ls.seen_at DESC) AS rn
  FROM public.listing_snapshots ls
  WHERE ls.asking_price IS NOT NULL AND ls.asking_price > 0
),
first_snap AS (
  SELECT
    ls.listing_id,
    min(ls.seen_at) AS first_seen_at,
    min(ls.asking_price) FILTER (WHERE ls.asking_price IS NOT NULL AND ls.asking_price > 0) AS first_price
  FROM public.listing_snapshots ls
  GROUP BY ls.listing_id
),
price_changes AS (
  SELECT
    listing_id,
    count(*) - 1 AS price_change_count,
    max(seen_at) AS last_price_change_at
  FROM (
    SELECT 
      listing_id,
      seen_at,
      asking_price,
      lag(asking_price) OVER (PARTITION BY listing_id ORDER BY seen_at) AS prev_price
    FROM public.listing_snapshots
    WHERE asking_price IS NOT NULL AND asking_price > 0
  ) sub
  WHERE asking_price IS DISTINCT FROM prev_price OR prev_price IS NULL
  GROUP BY listing_id
)
SELECT
  vl.id,
  vl.listing_id,
  vl.source,
  vl.source_class,
  -- Extract trap slug from dealer_site:slug format
  regexp_replace(vl.source, '^dealer_site:', '') AS trap_slug,
  -- Core vehicle fields
  upper(coalesce(vl.make, 'UNKNOWN')) AS make,
  upper(coalesce(vl.model, 'UNKNOWN')) AS model,
  upper(coalesce(vl.variant_family, 'ALL')) AS variant_family,
  vl.year,
  vl.km,
  vl.location,
  public.location_to_region(vl.location) AS region_id,
  vl.listing_url,
  vl.status,
  -- Pricing + time
  ls.asking_price,
  fs.first_seen_at,
  fs.first_price,
  (current_date - fs.first_seen_at::date) AS days_on_market,
  COALESCE(pc.price_change_count, 0) AS price_change_count,
  pc.last_price_change_at,
  -- Band keys for joining
  (public.year_to_band(vl.year)).year_min AS year_band_min,
  (public.year_to_band(vl.year)).year_max AS year_band_max,
  (public.km_to_band(vl.km)).km_band_min AS km_band_min,
  (public.km_to_band(vl.km)).km_band_max AS km_band_max
FROM public.vehicle_listings vl
JOIN latest_snap ls ON ls.listing_id = vl.id AND ls.rn = 1
LEFT JOIN first_snap fs ON fs.listing_id = vl.id
LEFT JOIN price_changes pc ON pc.listing_id = vl.id
WHERE vl.source_class = 'classifieds'
  AND vl.source LIKE 'dealer_site:%'
  AND vl.is_dealer_grade = true
  AND vl.status NOT IN ('cleared', 'sold', 'removed');

-- C) trap_deals: join inventory to fingerprints with fallback logic
CREATE VIEW public.trap_deals AS
WITH fp AS (
  SELECT
    region_id, make, model, variant_family,
    year_min, year_max, km_band_min, km_band_max,
    listing_total, cleared_total, relisted_total,
    avg_days_to_clear,
    avg_price AS fingerprint_price
  FROM public.fingerprint_outcomes_latest
  WHERE cleared_total >= 10
    AND avg_price IS NOT NULL
    AND avg_price > 0
)
SELECT
  ti.id,
  ti.listing_id,
  ti.source,
  ti.trap_slug,
  ti.make,
  ti.model,
  ti.variant_family,
  ti.year,
  ti.km,
  ti.location,
  ti.region_id,
  ti.listing_url,
  ti.status,
  ti.asking_price,
  ti.first_seen_at,
  ti.first_price,
  ti.days_on_market,
  ti.price_change_count,
  ti.last_price_change_at,
  -- Fingerprint: prefer exact variant match, fallback to 'ALL'
  COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) AS fingerprint_price,
  COALESCE(fp_exact.cleared_total, fp_all.cleared_total) AS fingerprint_sample,
  COALESCE(fp_exact.avg_days_to_clear, fp_all.avg_days_to_clear) AS fingerprint_ttd,
  -- Delta calculations
  (ti.asking_price - COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price)) AS delta_dollars,
  CASE
    WHEN COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) IS NULL THEN NULL
    ELSE ROUND(((ti.asking_price - COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price))::numeric 
           / COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) * 100), 1)
  END AS delta_pct,
  -- No benchmark flag
  (COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) IS NULL) AS no_benchmark,
  -- Deal label
  CASE
    WHEN COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) IS NULL THEN 'NO_BENCHMARK'
    WHEN (ti.asking_price - COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price))::numeric 
         / COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) <= -0.25 THEN 'MISPRICED'
    WHEN (ti.asking_price - COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price))::numeric 
         / COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) <= -0.15 THEN 'STRONG_BUY'
    WHEN (ti.asking_price - COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price))::numeric 
         / COALESCE(fp_exact.fingerprint_price, fp_all.fingerprint_price) <= -0.10 THEN 'WATCH'
    ELSE 'NORMAL'
  END AS deal_label
FROM public.trap_inventory_current ti
-- Exact variant match
LEFT JOIN fp fp_exact
  ON fp_exact.region_id = ti.region_id
 AND fp_exact.make = ti.make
 AND fp_exact.model = ti.model
 AND fp_exact.variant_family = ti.variant_family
 AND fp_exact.year_min = ti.year_band_min
 AND fp_exact.year_max = ti.year_band_max
 AND fp_exact.km_band_min = ti.km_band_min
 AND fp_exact.km_band_max = ti.km_band_max
-- Fallback to 'ALL' variant
LEFT JOIN fp fp_all
  ON fp_all.region_id = ti.region_id
 AND fp_all.make = ti.make
 AND fp_all.model = ti.model
 AND fp_all.variant_family = 'ALL'
 AND fp_all.year_min = ti.year_band_min
 AND fp_all.year_max = ti.year_band_max
 AND fp_all.km_band_min = ti.km_band_min
 AND fp_all.km_band_max = ti.km_band_max;

-- D) trap_deals_90_plus: convenience view for aged stock
CREATE VIEW public.trap_deals_90_plus AS
SELECT *
FROM public.trap_deals
WHERE days_on_market >= 90
ORDER BY delta_pct ASC NULLS LAST, days_on_market DESC;

-- 2) Create trap_deal_alerts table for daily alerts
CREATE TABLE IF NOT EXISTS public.trap_deal_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL,
  alert_date date NOT NULL DEFAULT CURRENT_DATE,
  deal_label text NOT NULL,
  delta_pct numeric,
  fingerprint_sample integer,
  trap_slug text,
  make text,
  model text,
  year integer,
  asking_price integer,
  fingerprint_price integer,
  slack_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(listing_id, alert_date)
);

-- Enable RLS on trap_deal_alerts
ALTER TABLE public.trap_deal_alerts ENABLE ROW LEVEL SECURITY;

-- Admins can read all alerts
CREATE POLICY "Admins can read trap deal alerts" ON public.trap_deal_alerts
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Index for queries
CREATE INDEX IF NOT EXISTS idx_trap_deal_alerts_date ON public.trap_deal_alerts(alert_date DESC);
CREATE INDEX IF NOT EXISTS idx_trap_deal_alerts_listing ON public.trap_deal_alerts(listing_id);

-- 3) Update user_watchlist to support trap inventory
-- Already exists, just need to ensure it has the right columns
ALTER TABLE public.user_watchlist 
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_watching boolean DEFAULT true;

-- Ensure unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_watchlist_user_listing 
  ON public.user_watchlist(user_id, listing_id);

-- RLS for watchlist (users can only see their own)
DROP POLICY IF EXISTS "Users can view their own watchlist" ON public.user_watchlist;
DROP POLICY IF EXISTS "Users can insert their own watchlist" ON public.user_watchlist;
DROP POLICY IF EXISTS "Users can update their own watchlist" ON public.user_watchlist;
DROP POLICY IF EXISTS "Users can delete their own watchlist" ON public.user_watchlist;

CREATE POLICY "Users can view their own watchlist" ON public.user_watchlist
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own watchlist" ON public.user_watchlist
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own watchlist" ON public.user_watchlist
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own watchlist" ON public.user_watchlist
  FOR DELETE USING (auth.uid() = user_id);