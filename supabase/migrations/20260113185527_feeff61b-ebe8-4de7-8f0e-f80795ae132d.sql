-- Add last_crawl_fail_at column (others already exist)
ALTER TABLE public.auction_sources
  ADD COLUMN IF NOT EXISTS last_crawl_fail_at timestamptz;

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_auction_sources_enabled ON public.auction_sources(enabled);
CREATE INDEX IF NOT EXISTS idx_auction_sources_failures ON public.auction_sources(consecutive_failures);

-- RPC function to get auction sources health for UI
CREATE OR REPLACE FUNCTION public.get_auction_sources_health()
RETURNS TABLE(
  source_key text,
  display_name text,
  platform text,
  enabled boolean,
  preflight_status text,
  last_crawl_success_at timestamptz,
  last_crawl_fail_at timestamptz,
  consecutive_crawl_failures int,
  last_lots_found int,
  last_crawl_error text,
  auto_disabled_at timestamptz,
  auto_disabled_reason text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    a.source_key,
    a.display_name,
    a.platform,
    a.enabled,
    a.preflight_status,
    a.last_success_at AS last_crawl_success_at,
    a.last_crawl_fail_at,
    COALESCE(a.consecutive_failures, 0)::int AS consecutive_crawl_failures,
    a.last_lots_found::int,
    a.last_error AS last_crawl_error,
    a.auto_disabled_at,
    a.auto_disabled_reason
  FROM public.auction_sources a
  ORDER BY a.enabled DESC, COALESCE(a.last_success_at, '1970-01-01') DESC;
$$;