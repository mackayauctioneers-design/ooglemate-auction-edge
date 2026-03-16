
-- RPC to atomically increment relist_count
CREATE OR REPLACE FUNCTION public.increment_relist_count(p_listing_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE vehicle_listings 
  SET relist_count = relist_count + 1,
      updated_at = now()
  WHERE listing_id = p_listing_id;
$$;
