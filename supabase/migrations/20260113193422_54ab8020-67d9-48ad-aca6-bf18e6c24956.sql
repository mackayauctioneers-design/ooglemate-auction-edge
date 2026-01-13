-- RPC to create auction source safely
CREATE OR REPLACE FUNCTION public.create_auction_source(
  p_source_key text,
  p_display_name text,
  p_platform text,
  p_list_url text,
  p_region_hint text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  INSERT INTO public.auction_sources (
    source_key, display_name, platform, list_url, region_hint,
    enabled, notes, preflight_status, validation_status, created_at, updated_at
  )
  VALUES (
    p_source_key, p_display_name, p_platform, p_list_url, p_region_hint,
    false, 'Created via UI wizard', 'pending', 'candidate', now(), now()
  )
  ON CONFLICT (source_key) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    platform = EXCLUDED.platform,
    list_url = EXCLUDED.list_url,
    region_hint = EXCLUDED.region_hint,
    updated_at = now();
END;
$$;