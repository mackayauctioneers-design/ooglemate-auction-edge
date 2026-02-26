
-- ═══════════════════════════════════════════════════════
-- MANDATE FEED SYSTEM — Tables
-- ═══════════════════════════════════════════════════════

-- 1) active_mandates — "what I'm chasing"
CREATE TABLE public.active_mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  variant_family text,
  year_min int,
  year_max int,
  km_max int,
  price_max int,
  priority text NOT NULL DEFAULT 'med' CHECK (priority IN ('high', 'med', 'low')),
  run_frequency_minutes int NOT NULL DEFAULT 240,
  source_mask text[] NOT NULL DEFAULT '{pickles,toyota}',
  last_run_at timestamptz,
  next_run_at timestamptz DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.active_mandates ENABLE ROW LEVEL SECURITY;

-- Open read/write for service role (edge functions). No end-user auth needed yet.
CREATE POLICY "Service role full access on active_mandates"
  ON public.active_mandates FOR ALL
  USING (true) WITH CHECK (true);

-- 2) mandate_runs — execution log
CREATE TABLE public.mandate_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  mandates_due int DEFAULT 0,
  mandates_executed int DEFAULT 0,
  listings_fetched int DEFAULT 0,
  listings_upserted int DEFAULT 0,
  errors jsonb DEFAULT '[]'::jsonb
);

ALTER TABLE public.mandate_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on mandate_runs"
  ON public.mandate_runs FOR ALL
  USING (true) WITH CHECK (true);

-- 3) mandate_feed_items — the unified feed
CREATE TABLE public.mandate_feed_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id uuid NOT NULL REFERENCES public.active_mandates(id) ON DELETE CASCADE,
  source text NOT NULL,
  listing_id text NOT NULL,
  source_url text,
  make text,
  model text,
  variant text,
  year int,
  km int,
  asking_price int,
  location text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_price int,
  price_changed_at timestamptz,
  price_delta int,
  score int,
  expected_margin int,
  under_buy int,
  anchor_sale_id uuid,
  anchor_context jsonb,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Dedup: same listing from same source under same mandate
CREATE UNIQUE INDEX uq_mandate_feed_source_listing
  ON public.mandate_feed_items (mandate_id, source, listing_id);

-- Query performance indexes
CREATE INDEX idx_mandate_feed_mandate ON public.mandate_feed_items (mandate_id);
CREATE INDEX idx_mandate_feed_score ON public.mandate_feed_items (score DESC NULLS LAST);
CREATE INDEX idx_mandate_feed_first_seen ON public.mandate_feed_items (first_seen_at DESC);
CREATE INDEX idx_mandate_feed_price_changed ON public.mandate_feed_items (price_changed_at DESC NULLS LAST);

ALTER TABLE public.mandate_feed_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on mandate_feed_items"
  ON public.mandate_feed_items FOR ALL
  USING (true) WITH CHECK (true);

-- Schedule index for dispatcher
CREATE INDEX idx_mandates_due ON public.active_mandates (next_run_at)
  WHERE is_active = true;
