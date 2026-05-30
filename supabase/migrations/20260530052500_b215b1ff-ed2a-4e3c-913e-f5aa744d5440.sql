
-- Current state table: one row per active or recently-gone listing
CREATE TABLE public.westside_mike_listings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_listing_id TEXT NOT NULL UNIQUE,
  listing_url TEXT NOT NULL,
  title TEXT,
  make TEXT,
  model TEXT,
  variant TEXT,
  year INTEGER,
  km INTEGER,
  price NUMERIC,
  body_type TEXT,
  transmission TEXT,
  fuel TEXT,
  colour TEXT,
  vin TEXT,
  stock_no TEXT,
  photos JSONB DEFAULT '[]'::jsonb,
  description TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_snapshot_id UUID,
  status TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | GONE
  gone_at TIMESTAMPTZ,
  missed_snapshots INTEGER NOT NULL DEFAULT 0,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_westside_mike_listings_status ON public.westside_mike_listings(status);
CREATE INDEX idx_westside_mike_listings_last_seen ON public.westside_mike_listings(last_seen_at DESC);
CREATE INDEX idx_westside_mike_listings_make_model ON public.westside_mike_listings(make, model);

GRANT SELECT ON public.westside_mike_listings TO authenticated;
GRANT ALL ON public.westside_mike_listings TO service_role;
ALTER TABLE public.westside_mike_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can view westside mike listings"
ON public.westside_mike_listings FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Append-only history of every event
CREATE TABLE public.westside_mike_listing_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_listing_id TEXT NOT NULL,
  snapshot_id UUID,
  event_type TEXT NOT NULL,   -- NEW | PRICE_DROP | PRICE_RAISE | KM_UPDATE | GONE | RELISTED | SNAPSHOT
  prev_price NUMERIC,
  new_price NUMERIC,
  prev_km INTEGER,
  new_km INTEGER,
  days_on_lot INTEGER,
  payload JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wm_history_listing ON public.westside_mike_listing_history(source_listing_id, occurred_at DESC);
CREATE INDEX idx_wm_history_event ON public.westside_mike_listing_history(event_type, occurred_at DESC);

GRANT SELECT ON public.westside_mike_listing_history TO authenticated;
GRANT ALL ON public.westside_mike_listing_history TO service_role;
ALTER TABLE public.westside_mike_listing_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can view westside mike history"
ON public.westside_mike_listing_history FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- One row per Arby push
CREATE TABLE public.westside_mike_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'arby',
  listings_in INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  price_drop_count INTEGER NOT NULL DEFAULT 0,
  gone_count INTEGER NOT NULL DEFAULT 0,
  relisted_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

GRANT SELECT ON public.westside_mike_snapshots TO authenticated;
GRANT ALL ON public.westside_mike_snapshots TO service_role;
ALTER TABLE public.westside_mike_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Operators can view westside mike snapshots"
ON public.westside_mike_snapshots FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- updated_at trigger
CREATE TRIGGER trg_westside_mike_listings_updated_at
BEFORE UPDATE ON public.westside_mike_listings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
