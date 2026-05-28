INSERT INTO public.dealer_profile_user_links (user_id, dealer_profile_id)
SELECT dp.user_id, dp.id
FROM public.dealer_profiles dp
WHERE dp.user_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = dp.user_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.dealer_profile_user_links l
    WHERE l.user_id = dp.user_id AND l.dealer_profile_id = dp.id
  );