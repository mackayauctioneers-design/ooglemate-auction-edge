CREATE TABLE public.scanned_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  make text,
  model text,
  year integer,
  price numeric,
  mileage numeric,
  location text,
  listing_url text,
  source text NOT NULL DEFAULT 'VPS_Scanner',
  status text NOT NULL DEFAULT 'pending'
);

CREATE INDEX idx_scanned_deals_listing_url ON public.scanned_deals(listing_url);
CREATE INDEX idx_scanned_deals_created_at ON public.scanned_deals(created_at DESC);

ALTER TABLE public.scanned_deals ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.scanner_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  endpoint text,
  method text,
  status_code integer,
  ip text,
  error text,
  payload jsonb
);

CREATE INDEX idx_scanner_logs_created_at ON public.scanner_logs(created_at DESC);

ALTER TABLE public.scanner_logs ENABLE ROW LEVEL SECURITY;