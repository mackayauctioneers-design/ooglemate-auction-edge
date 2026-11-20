-- Follow-up to 0002 (found while checking 0002 on production, before any franchise request existed).
-- 0002 treated any member of a dealership with wholesale_pricing as a franchise dealer. Several Ooglecars yards have
-- wholesale_pricing for the normal tender feature, so their staff would have been able to use the franchise desk.
-- This narrows "dealer" to dealerships that have the dedicated feature carbitrage_franchise_wholesale on. Nothing is granted
-- by this file: a dealership gets access only when a row for that feature is added for it.
-- Undo: carbitrage-wholesale-0003-franchise-feature.undo.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.carbitrage_wholesale_dealership_v1(_user uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT m.dealership_id
    FROM public.dealership_members m
    JOIN public.dealership_features f
      ON f.dealership_id = m.dealership_id AND f.feature_key = 'carbitrage_franchise_wholesale' AND f.enabled
   WHERE m.user_id = _user
   ORDER BY m.joined_at
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.carbitrage_wholesale_dealership_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carbitrage_wholesale_dealership_v1(uuid) TO service_role;

COMMIT;
