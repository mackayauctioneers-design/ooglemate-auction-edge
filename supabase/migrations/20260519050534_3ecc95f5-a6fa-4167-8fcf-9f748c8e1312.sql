CREATE TABLE IF NOT EXISTS public.star_watch_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  listing_id text,
  listing_url text NOT NULL,
  source text,
  http_status int,
  scrape_status text,
  title text,
  price_aud numeric,
  odometer_km int,
  year int,
  make text,
  model text,
  variant text,
  state text,
  seller_name text,
  auction_date timestamptz,
  current_status text,
  notes text,
  raw jsonb,
  error text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS star_watch_results_job_idx ON public.star_watch_results(job_id);
CREATE INDEX IF NOT EXISTS star_watch_results_listing_idx ON public.star_watch_results(listing_id);

ALTER TABLE public.star_watch_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "star_watch_results service role all"
  ON public.star_watch_results
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');