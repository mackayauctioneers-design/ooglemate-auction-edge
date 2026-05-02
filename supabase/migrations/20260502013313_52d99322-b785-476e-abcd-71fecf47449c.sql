-- Drop old experimental pulse_alerts (no production deps yet)
DROP TABLE IF EXISTS public.pulse_alerts CASCADE;

CREATE TABLE public.pulse_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_listing_id uuid,
  source text,
  source_listing_id text,
  listing_url text,
  make text NOT NULL,
  model text NOT NULL,
  year int,
  km int,
  price numeric,
  status text,
  composite_score numeric,
  tier int,
  margin_score int,
  conf_score int,
  gap numeric,
  benchmark_value numeric,
  benchmark_n int,
  alert_band text NOT NULL CHECK (alert_band IN ('HOT','WARM')),
  delivered_via text,
  delivered_at timestamptz,
  first_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX pulse_alerts_unique_per_listing_band
  ON public.pulse_alerts (market_listing_id, alert_band);

CREATE INDEX pulse_alerts_pending ON public.pulse_alerts (alert_band, delivered_at)
  WHERE delivered_at IS NULL;

CREATE INDEX pulse_alerts_recency ON public.pulse_alerts (created_at DESC);

ALTER TABLE public.pulse_alerts ENABLE ROW LEVEL SECURITY;
-- No public policies: only service-role edge functions access this table.