-- Drop and recreate get_trap_deals() to add sold_returned columns
DROP FUNCTION IF EXISTS public.get_trap_deals();

CREATE OR REPLACE FUNCTION public.get_trap_deals()
RETURNS TABLE (
  id uuid,
  listing_id text,
  trap_slug text,
  make text,
  model text,
  variant_family text,
  year integer,
  km integer,
  asking_price numeric,
  first_price numeric,
  first_seen_at timestamptz,
  source text,
  status text,
  listing_url text,
  location text,
  region_id text,
  days_on_market integer,
  price_change_count integer,
  last_price_change_at timestamptz,
  fingerprint_price numeric,
  fingerprint_sample integer,
  fingerprint_ttd integer,
  delta_dollars numeric,
  delta_pct numeric,
  deal_label text,
  no_benchmark boolean,
  sold_returned_suspected boolean,
  sold_returned_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if user is admin or internal
  IF NOT is_admin_or_internal() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 
    td.id,
    td.listing_id,
    td.trap_slug,
    td.make,
    td.model,
    td.variant_family,
    td.year,
    td.km,
    td.asking_price,
    td.first_price,
    td.first_seen_at,
    td.source,
    td.status,
    td.listing_url,
    td.location,
    td.region_id,
    td.days_on_market,
    td.price_change_count,
    td.last_price_change_at,
    td.fingerprint_price,
    td.fingerprint_sample,
    td.fingerprint_ttd,
    td.delta_dollars,
    td.delta_pct,
    td.deal_label,
    td.no_benchmark,
    COALESCE(vl.sold_returned_suspected, false) as sold_returned_suspected,
    vl.sold_returned_reason
  FROM trap_deals td
  LEFT JOIN vehicle_listings vl ON vl.id = td.id
  ORDER BY td.delta_pct ASC NULLS LAST, td.days_on_market DESC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_trap_deals() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trap_deals() TO service_role;