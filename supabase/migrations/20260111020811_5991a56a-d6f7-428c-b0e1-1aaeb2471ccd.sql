-- Harden RPC: raise 403 for non-admin instead of returning empty
CREATE OR REPLACE FUNCTION public.get_trap_deals()
RETURNS TABLE(
  id uuid, 
  listing_id text, 
  make text, 
  model text, 
  variant_family text, 
  year integer, 
  km integer,
  asking_price integer, 
  first_seen_at timestamp with time zone, 
  first_price integer, 
  days_on_market integer,
  price_change_count bigint, 
  last_price_change_at timestamp with time zone, 
  fingerprint_price numeric,
  fingerprint_sample integer, 
  fingerprint_ttd numeric, 
  delta_dollars numeric, 
  delta_pct numeric,
  no_benchmark boolean, 
  deal_label text, 
  listing_url text, 
  location text, 
  source text, 
  trap_slug text, 
  status text, 
  region_id text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check admin/internal role first
  IF NOT is_admin_or_internal() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  
  RETURN QUERY
  SELECT 
    t.id, t.listing_id, t.make, t.model, t.variant_family, t.year, t.km,
    t.asking_price, t.first_seen_at, t.first_price, t.days_on_market,
    t.price_change_count, t.last_price_change_at, t.fingerprint_price,
    t.fingerprint_sample, t.fingerprint_ttd, t.delta_dollars, t.delta_pct,
    t.no_benchmark, t.deal_label, t.listing_url, t.location, t.source, t.trap_slug, t.status, t.region_id
  FROM trap_deals t
  ORDER BY t.delta_pct ASC NULLS LAST, t.days_on_market DESC;
END;
$$;