CREATE TABLE public.alerted_listings (
  listing_id text PRIMARY KEY,
  payload_hash text,
  alerted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.alerted_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on alerted_listings"
ON public.alerted_listings
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);