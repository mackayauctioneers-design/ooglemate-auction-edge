-- Add unique constraint on listing_url for upsert support
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_listing_url_unique ON public.opportunities (listing_url);