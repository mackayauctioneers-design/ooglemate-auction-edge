-- Repair bad Pickles search URLs in operator_opportunities by copying correct URL from vehicle_listings
UPDATE public.operator_opportunities oo
SET source_url = vl.listing_url,
    updated_at = now()
FROM public.vehicle_listings vl
WHERE vl.listing_id = oo.listing_id
  AND (oo.source_url LIKE '%/used/search%' OR oo.source_url LIKE '%/cars/search%')
  AND vl.listing_url IS NOT NULL
  AND vl.listing_url NOT LIKE '%/search%';