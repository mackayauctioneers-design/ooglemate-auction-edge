-- Upgrade source_registry for repeatable dealer group onboarding
-- Add columns: enabled, base_url, ingest_lane, geo_required, stale_days

ALTER TABLE public.source_registry
ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS base_url text,
ADD COLUMN IF NOT EXISTS ingest_lane text CHECK (ingest_lane IN ('API', 'HTML', 'SITEMAP', 'FIRECRAWL')),
ADD COLUMN IF NOT EXISTS geo_required boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS stale_days integer NOT NULL DEFAULT 3;

-- Update source_type to use your taxonomy
ALTER TABLE public.source_registry
DROP CONSTRAINT IF EXISTS source_registry_source_type_check;

ALTER TABLE public.source_registry
ADD CONSTRAINT source_registry_source_type_check 
CHECK (source_type IN ('RETAIL', 'AUCTION', 'DEALER_TRAP', 'MARKETPLACE', 'DEALER_GROUP', 'OEM'));

-- Update existing records with sensible defaults
UPDATE public.source_registry SET 
  enabled = true,
  ingest_lane = 'API',
  geo_required = false,
  stale_days = 3
WHERE source = 'autotrader';

UPDATE public.source_registry SET 
  enabled = true,
  ingest_lane = 'FIRECRAWL',
  geo_required = false,
  stale_days = 3
WHERE source = 'gumtree';

UPDATE public.source_registry SET 
  ingest_lane = 'FIRECRAWL',
  geo_required = true,
  stale_days = 3
WHERE source_type IN ('AUCTION', 'DEALER_TRAP');

-- Add index for enabled sources lookup
CREATE INDEX IF NOT EXISTS idx_source_registry_enabled 
ON public.source_registry(enabled) WHERE enabled = true;

COMMENT ON TABLE public.source_registry IS 'Central registry for all ingestion sources. Add new dealer groups/marketplaces here to enable the onboarding lane.';
COMMENT ON COLUMN public.source_registry.ingest_lane IS 'API = direct API call, HTML = Firecrawl HTML parse, SITEMAP = sitemap discovery, FIRECRAWL = Firecrawl scrape';