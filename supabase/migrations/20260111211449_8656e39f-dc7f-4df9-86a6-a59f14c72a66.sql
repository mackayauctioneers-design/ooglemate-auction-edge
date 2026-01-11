-- Create auction_sources registry table
CREATE TABLE public.auction_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'bidsonline' CHECK (platform IN ('bidsonline', 'custom')),
  list_url TEXT NOT NULL,
  region_hint TEXT NOT NULL DEFAULT 'NSW_REGIONAL',
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_success_at TIMESTAMP WITH TIME ZONE,
  last_lots_found INTEGER,
  last_error TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.auction_sources ENABLE ROW LEVEL SECURITY;

-- Operators can read auction sources
CREATE POLICY "Operators can view auction sources"
  ON public.auction_sources FOR SELECT
  USING (is_admin_or_internal());

-- Operators can manage auction sources
CREATE POLICY "Operators can manage auction sources"
  ON public.auction_sources FOR ALL
  USING (is_admin_or_internal());

-- Trigger for updated_at
CREATE TRIGGER update_auction_sources_updated_at
  BEFORE UPDATE ON public.auction_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create RPC function for auction source stats (for ingestion health dashboard)
CREATE OR REPLACE FUNCTION public.get_auction_source_stats()
RETURNS TABLE(
  source_key TEXT,
  display_name TEXT,
  platform TEXT,
  region_hint TEXT,
  enabled BOOLEAN,
  last_success_at TIMESTAMP WITH TIME ZONE,
  last_lots_found INTEGER,
  today_runs BIGINT,
  today_created BIGINT,
  today_updated BIGINT,
  today_dropped BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH today_runs AS (
    SELECT 
      REPLACE(ir.source, 'auction-', '') AS source_key,
      COUNT(*) AS runs,
      SUM(ir.lots_created) AS created,
      SUM(ir.lots_updated) AS updated,
      SUM(COALESCE((ir.metadata->>'dropped')::int, 0)) AS dropped
    FROM ingestion_runs ir
    WHERE ir.source LIKE 'auction-%'
      AND ir.started_at >= CURRENT_DATE
    GROUP BY REPLACE(ir.source, 'auction-', '')
  )
  SELECT 
    asr.source_key,
    asr.display_name,
    asr.platform,
    asr.region_hint,
    asr.enabled,
    asr.last_success_at,
    asr.last_lots_found,
    COALESCE(tr.runs, 0) AS today_runs,
    COALESCE(tr.created, 0) AS today_created,
    COALESCE(tr.updated, 0) AS today_updated,
    COALESCE(tr.dropped, 0) AS today_dropped
  FROM auction_sources asr
  LEFT JOIN today_runs tr ON tr.source_key = asr.source_key
  ORDER BY asr.enabled DESC, asr.display_name;
$$;

-- Seed Auto Auctions Sydney as first source
INSERT INTO public.auction_sources (source_key, display_name, platform, list_url, region_hint, enabled, notes)
VALUES (
  'autoauctions_sydney',
  'Auto Auctions Sydney',
  'bidsonline',
  'https://autoauctions.com.au/auction/search?cat=cars',
  'NSW_SYDNEY_METRO',
  true,
  'Primary Sydney metro auction. Uses BidsOnline platform.'
);

-- Seed Valley Motor Auctions (Hunter - already has custom crawler but can migrate)
INSERT INTO public.auction_sources (source_key, display_name, platform, list_url, region_hint, enabled, notes)
VALUES (
  'valley_motor_auctions',
  'Valley Motor Auctions',
  'bidsonline',
  'https://valleymotorauctions.com.au/vehicle-list/',
  'NSW_HUNTER_NEWCASTLE',
  false,
  'Hunter region. Has existing custom crawler - migrate to BidsOnline later.'
);

-- Seed F3 Motor Auctions (Hunter - already has custom crawler)
INSERT INTO public.auction_sources (source_key, display_name, platform, list_url, region_hint, enabled, notes)
VALUES (
  'f3_motor_auctions',
  'F3 Motor Auctions',
  'bidsonline',
  'https://f3motorauctions.com.au/vehicle-list/',
  'NSW_HUNTER_NEWCASTLE',
  false,
  'Hunter region. Has existing custom crawler.'
);