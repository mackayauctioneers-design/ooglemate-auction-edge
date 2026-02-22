
DROP FUNCTION public.get_dealer_profile_by_user(uuid);

CREATE FUNCTION public.get_dealer_profile_by_user(_user_id uuid)
 RETURNS TABLE(dealer_profile_id uuid, dealer_name text, org_id text, region_id text, account_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    dp.id as dealer_profile_id,
    dp.dealer_name,
    dp.org_id,
    dp.region_id,
    dp.account_id
  FROM public.dealer_profile_user_links link
  JOIN public.dealer_profiles dp ON dp.id = link.dealer_profile_id
  WHERE link.user_id = _user_id
  LIMIT 1
$function$;
