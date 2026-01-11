-- Create a security function to check if user is admin/internal
CREATE OR REPLACE FUNCTION public.is_admin_or_internal()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'internal')
  )
$$;

-- Create a secure RPC wrapper for trap_deals that checks admin status
CREATE OR REPLACE FUNCTION public.get_trap_deals()
RETURNS TABLE (
  id uuid,
  listing_id text,
  make text,
  model text,
  variant_family text,
  year integer,
  km integer,
  asking_price integer,
  first_seen_at timestamptz,
  first_price integer,
  days_on_market integer,
  price_change_count bigint,
  last_price_change_at timestamptz,
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    id, listing_id, make, model, variant_family, year, km,
    asking_price, first_seen_at, first_price, days_on_market,
    price_change_count, last_price_change_at, fingerprint_price,
    fingerprint_sample, fingerprint_ttd, delta_dollars, delta_pct,
    no_benchmark, deal_label, listing_url, location, source, trap_slug, status, region_id
  FROM trap_deals
  WHERE is_admin_or_internal()
$$;