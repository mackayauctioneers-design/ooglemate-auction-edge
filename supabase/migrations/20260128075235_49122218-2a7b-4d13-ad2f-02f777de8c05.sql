-- Add unique constraint on vehicle_listings(listing_id, source) for upsert operations
-- This is required for the Manheim and Pickles deep-fetch pipelines

-- First check if constraint exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'vehicle_listings_listing_id_source_key'
  ) THEN
    ALTER TABLE public.vehicle_listings 
    ADD CONSTRAINT vehicle_listings_listing_id_source_key 
    UNIQUE (listing_id, source);
  END IF;
END $$;

-- Create index if not exists for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_listing_id_source 
ON public.vehicle_listings(listing_id, source);