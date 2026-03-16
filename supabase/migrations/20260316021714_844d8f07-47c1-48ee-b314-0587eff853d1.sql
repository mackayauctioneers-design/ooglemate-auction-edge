
-- Deal flags table for Opportunity Engine
CREATE TABLE IF NOT EXISTS public.deal_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id text NOT NULL,
  listing_url text,
  flag_type text NOT NULL,
  confidence numeric NOT NULL DEFAULT 0,
  price numeric,
  price_gap numeric,
  price_gap_pct numeric,
  market_spread numeric,
  cluster_key text NOT NULL,
  cluster_size int NOT NULL DEFAULT 0,
  make text,
  model text,
  variant text,
  year int,
  km int,
  source text,
  location text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(listing_id, flag_type)
);

CREATE INDEX IF NOT EXISTS idx_deal_flags_active ON public.deal_flags (flag_type, expires_at);
CREATE INDEX IF NOT EXISTS idx_deal_flags_listing ON public.deal_flags (listing_id);
CREATE INDEX IF NOT EXISTS idx_deal_flags_cluster ON public.deal_flags (cluster_key);

ALTER TABLE public.deal_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to deal_flags"
  ON public.deal_flags FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Allow service role full access to deal_flags"
  ON public.deal_flags FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
