-- UNDO for carbitrage-wholesale-0003-franchise-feature.sql: back to the 0002 definition (wholesale_pricing).
BEGIN;
CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_dealership_v1(_user uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT m.dealership_id
    FROM public.dealership_members m
    JOIN public.dealership_features f
      ON f.dealership_id = m.dealership_id AND f.feature_key = 'wholesale_pricing' AND f.enabled
   WHERE m.user_id = _user
   ORDER BY m.joined_at
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.carbitrage_wholesale_dealership_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carbitrage_wholesale_dealership_v1(uuid) TO service_role;
COMMIT;
