
-- Add price_badge column to retail_listings
ALTER TABLE public.retail_listings ADD COLUMN IF NOT EXISTS price_badge text;

-- Update market_listings view to expose price_badge
CREATE OR REPLACE VIEW public.market_listings AS
SELECT
    vehicle_listings.id,
    vehicle_listings.source,
    vehicle_listings.source_class,
    vehicle_listings.auction_house,
    vehicle_listings.make,
    vehicle_listings.model,
    vehicle_listings.variant_raw,
    vehicle_listings.year,
    vehicle_listings.km,
    vehicle_listings.asking_price,
    vehicle_listings.state AS location,
    vehicle_listings.listing_url,
    vehicle_listings.last_seen_at,
    vehicle_listings.transmission,
    vehicle_listings.fuel,
    vehicle_listings.drivetrain,
    'inventory'::text AS listing_type,
    NULL::text AS price_badge
FROM vehicle_listings
WHERE vehicle_listings.status = ANY (ARRAY['listed'::text, 'catalogue'::text])
UNION ALL
SELECT
    retail_listings.id,
    retail_listings.source,
    NULL::text AS source_class,
    NULL::text AS auction_house,
    retail_listings.make,
    retail_listings.model,
    retail_listings.variant_raw,
    retail_listings.year,
    retail_listings.km,
    retail_listings.asking_price,
    retail_listings.state AS location,
    retail_listings.listing_url,
    retail_listings.last_seen_at,
    retail_listings.transmission,
    retail_listings.fuel_type AS fuel,
    retail_listings.drivetrain,
    'retail'::text AS listing_type,
    retail_listings.price_badge
FROM retail_listings
WHERE retail_listings.delisted_at IS NULL;
