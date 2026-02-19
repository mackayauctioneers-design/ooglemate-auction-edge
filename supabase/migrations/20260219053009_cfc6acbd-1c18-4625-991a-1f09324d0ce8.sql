-- Add created_at to vehicle_listings for ingestion traceability
ALTER TABLE public.vehicle_listings 
ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();