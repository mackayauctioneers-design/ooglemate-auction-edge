
CREATE OR REPLACE FUNCTION public.get_my_star_watch_reports(_limit integer DEFAULT 25)
RETURNS TABLE (
  id uuid,
  job_id uuid,
  listing_url text,
  source text,
  scrape_status text,
  title text,
  price_aud numeric,
  odometer_km integer,
  year integer,
  make text,
  model text,
  variant text,
  state text,
  seller_name text,
  auction_date timestamptz,
  current_status text,
  notes text,
  received_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.job_id, r.listing_url, r.source, r.scrape_status, r.title,
         r.price_aud, r.odometer_km, r.year, r.make, r.model, r.variant,
         r.state, r.seller_name, r.auction_date, r.current_status, r.notes,
         r.received_at
  FROM public.star_watch_results r
  JOIN public.outward_jobs oj ON oj.id = r.job_id
  JOIN public.dealer_profiles dp ON dp.account_id::text = oj.account_id
  JOIN public.dealer_profile_user_links link ON link.dealer_profile_id = dp.id
  WHERE link.user_id = auth.uid()
  ORDER BY r.received_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 200));
$$;

GRANT EXECUTE ON FUNCTION public.get_my_star_watch_reports(integer) TO authenticated;

UPDATE public.dealer_notification_settings
SET dealer_id = 'af58cc21-9657-49c2-97ed-74f82d5ace65'
WHERE email = 'aaron@thecarboutique.com.au'
  AND dealer_id <> 'af58cc21-9657-49c2-97ed-74f82d5ace65';
