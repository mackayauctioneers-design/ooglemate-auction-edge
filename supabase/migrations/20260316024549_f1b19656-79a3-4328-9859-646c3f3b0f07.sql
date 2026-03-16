
-- CarOogle Finds table: the canonical output of the opportunity engine
CREATE TABLE public.caroogle_finds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id TEXT NOT NULL,
  make TEXT,
  model TEXT,
  series TEXT,
  variant TEXT,
  year INTEGER,
  km INTEGER,
  price NUMERIC,
  median_price NUMERIC,
  lowest_price NUMERIC,
  second_lowest_price NUMERIC,
  spread NUMERIC,
  discount_percent NUMERIC,
  score INTEGER NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'LOW',
  reasons TEXT[] NOT NULL DEFAULT '{}',
  flag_types TEXT[] NOT NULL DEFAULT '{}',
  source TEXT,
  location TEXT,
  listing_url TEXT,
  image_url TEXT,
  cluster_key TEXT NOT NULL,
  cluster_size INTEGER NOT NULL DEFAULT 0,
  avg_days_on_market NUMERIC,
  is_auction BOOLEAN NOT NULL DEFAULT false,
  auction_arbitrage_gap NUMERIC,
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  status TEXT NOT NULL DEFAULT 'active',
  UNIQUE(listing_id)
);

-- Index for querying active finds
CREATE INDEX idx_caroogle_finds_active ON public.caroogle_finds(status, score DESC) WHERE status = 'active';
CREATE INDEX idx_caroogle_finds_expires ON public.caroogle_finds(expires_at);

-- RLS: allow authenticated read access (global data accessibility standard)
ALTER TABLE public.caroogle_finds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read caroogle_finds"
  ON public.caroogle_finds FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Service role can manage caroogle_finds"
  ON public.caroogle_finds FOR ALL TO service_role
  USING (true) WITH CHECK (true);
