-- Auction enrichment columns for Manus detail pipeline

-- pickles_detail_queue: add condition / auction-specific fields
ALTER TABLE public.pickles_detail_queue
  ADD COLUMN IF NOT EXISTS fuel              TEXT,
  ADD COLUMN IF NOT EXISTS transmission      TEXT,
  ADD COLUMN IF NOT EXISTS wovr_indicator    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS damage_noted      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS keys_present      BOOLEAN,
  ADD COLUMN IF NOT EXISTS starts_drives     BOOLEAN,
  ADD COLUMN IF NOT EXISTS condition_notes   TEXT[],
  ADD COLUMN IF NOT EXISTS reserve_status    TEXT,
  ADD COLUMN IF NOT EXISTS price_type        TEXT;

-- vehicle_listings: add auction-specific enrichment fields
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS wovr_indicator    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS damage_noted      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS keys_present      BOOLEAN,
  ADD COLUMN IF NOT EXISTS starts_drives     BOOLEAN,
  ADD COLUMN IF NOT EXISTS condition_notes   TEXT[],
  ADD COLUMN IF NOT EXISTS reserve_status    TEXT,
  ADD COLUMN IF NOT EXISTS guide_price       INTEGER,
  ADD COLUMN IF NOT EXISTS reserve_price     INTEGER,
  ADD COLUMN IF NOT EXISTS sold_price        INTEGER,
  ADD COLUMN IF NOT EXISTS buy_method        TEXT,
  ADD COLUMN IF NOT EXISTS sale_close_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sale_status       TEXT;

-- Register auction-detail-enricher for health monitoring
INSERT INTO public.ingestion_sources (source_key, display_name, enabled, expected_interval_minutes, min_listings_24h, cron_schedule)
VALUES (
  'auction-detail-enricher',
  'Auction Detail Enricher (Manus)',
  true,
  10,
  100,
  '*/10 * * * *'
)
ON CONFLICT (source_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  enabled = EXCLUDED.enabled,
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  cron_schedule = EXCLUDED.cron_schedule;