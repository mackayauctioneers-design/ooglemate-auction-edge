
-- Pickles Buy Now global feed table
CREATE TABLE public.pickles_buy_now_listings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_url TEXT NOT NULL UNIQUE,
  listing_id TEXT GENERATED ALWAYS AS (md5(listing_url)) STORED,
  year INTEGER,
  make TEXT,
  model TEXT,
  variant TEXT,
  kms INTEGER,
  price NUMERIC,
  location TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  matched_fingerprint_id UUID REFERENCES public.sales_target_candidates(id),
  match_alerted_at TIMESTAMPTZ
);

-- Index for fast fingerprint joins
CREATE INDEX idx_pbn_make_model ON public.pickles_buy_now_listings (make, model);
CREATE INDEX idx_pbn_first_seen ON public.pickles_buy_now_listings (first_seen_at DESC);

-- RLS
ALTER TABLE public.pickles_buy_now_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read buy now listings"
  ON public.pickles_buy_now_listings FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage buy now listings"
  ON public.pickles_buy_now_listings FOR ALL
  USING (auth.role() = 'service_role');
