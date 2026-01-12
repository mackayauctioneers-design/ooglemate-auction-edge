-- Drop and recreate get_trap_deals with missing_streak

DROP FUNCTION IF EXISTS public.get_trap_deals();

CREATE FUNCTION public.get_trap_deals()
 RETURNS TABLE(
   id uuid, 
   listing_id text, 
   make text, 
   model text, 
   variant_family text, 
   year integer, 
   km integer, 
   asking_price numeric, 
   first_seen_at timestamp with time zone, 
   source text, 
   status text, 
   listing_url text, 
   location text, 
   region_id text, 
   days_on_market integer, 
   price_change_count integer, 
   last_price_change_at timestamp with time zone, 
   first_price numeric, 
   fingerprint_price numeric, 
   fingerprint_sample integer, 
   fingerprint_ttd numeric, 
   delta_dollars numeric, 
   delta_pct numeric, 
   deal_label text, 
   no_benchmark boolean, 
   sold_returned_suspected boolean, 
   sold_returned_reason text, 
   watch_status text, 
   watch_reason text, 
   buy_window_at timestamp with time zone, 
   tracked_by text, 
   attempt_count smallint, 
   attempt_stage text, 
   avoid_reason text, 
   watch_confidence text, 
   assigned_to text, 
   assigned_at timestamp with time zone, 
   lifecycle_state text,
   missing_streak integer
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Check if user is admin or internal
  IF NOT is_admin_or_internal() THEN
    RAISE EXCEPTION 'Access forbidden: admin or internal role required' 
      USING ERRCODE = '42501';
  END IF;
  
  RETURN QUERY
  SELECT 
    td.id,
    td.listing_id,
    td.make,
    td.model,
    td.variant_family,
    td.year,
    td.km,
    td.asking_price,
    td.first_seen_at,
    td.source,
    td.status,
    td.listing_url,
    td.location,
    td.region_id,
    td.days_on_market,
    td.price_change_count,
    td.last_price_change_at,
    td.first_price,
    td.fingerprint_price,
    td.fingerprint_sample,
    td.fingerprint_ttd,
    td.delta_dollars,
    td.delta_pct,
    td.deal_label,
    td.no_benchmark,
    vl.sold_returned_suspected,
    vl.sold_returned_reason,
    vl.watch_status,
    vl.watch_reason,
    vl.buy_window_at,
    vl.tracked_by,
    vl.attempt_count,
    vl.attempt_stage,
    vl.avoid_reason,
    vl.watch_confidence,
    vl.assigned_to,
    vl.assigned_at,
    vl.lifecycle_state,
    vl.missing_streak
  FROM trap_deals td
  LEFT JOIN vehicle_listings vl ON td.id = vl.id
  ORDER BY td.delta_pct ASC NULLS LAST, td.days_on_market DESC;
END;
$function$;