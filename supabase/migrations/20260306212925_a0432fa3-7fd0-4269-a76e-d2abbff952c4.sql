
ALTER TABLE public.retail_listings
  ADD COLUMN IF NOT EXISTS colour text,
  ADD COLUMN IF NOT EXISTS image_urls jsonb,
  ADD COLUMN IF NOT EXISTS details_scraped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS details_scraped_at timestamptz,
  ADD COLUMN IF NOT EXISTS details_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS details_failed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_retail_listings_details_pending
  ON public.retail_listings (details_scraped, details_failed, details_attempts)
  WHERE details_scraped = false AND details_failed = false;
