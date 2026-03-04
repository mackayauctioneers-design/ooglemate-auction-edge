
CREATE TABLE public.market_listing_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id text,
  url text,
  source_site text NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  variant text,
  year integer,
  price integer,
  km integer,
  dealer text,
  seller_type text,
  state text,
  stock_number text,
  image_url text,
  discovered_by text NOT NULL DEFAULT 'unknown',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  price_at_first_seen integer,
  price_at_last_seen integer,
  UNIQUE (listing_id, source_site)
);

CREATE INDEX idx_mlh_make_model ON public.market_listing_history (make, model);
CREATE INDEX idx_mlh_listing_id ON public.market_listing_history (listing_id);
CREATE INDEX idx_mlh_last_seen ON public.market_listing_history (last_seen_at);

ALTER TABLE public.market_listing_history ENABLE ROW LEVEL SECURITY;
