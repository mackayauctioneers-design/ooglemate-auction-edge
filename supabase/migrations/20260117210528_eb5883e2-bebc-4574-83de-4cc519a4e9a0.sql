-- Add missing columns to listing_enrichment_queue
ALTER TABLE public.listing_enrichment_queue 
ADD COLUMN IF NOT EXISTS locked_until timestamptz,
ADD COLUMN IF NOT EXISTS lock_token uuid;

-- Recreate index for queue processing
DROP INDEX IF EXISTS idx_enrichment_queue_status;
CREATE INDEX idx_enrichment_queue_status ON public.listing_enrichment_queue (status, locked_until, priority);