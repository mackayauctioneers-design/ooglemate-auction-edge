-- 1. Add lifecycle state column with enum-like constraint
ALTER TABLE public.vehicle_listings
ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'NEW'
CONSTRAINT lifecycle_state_valid CHECK (lifecycle_state IN (
  'NEW',
  'WATCH',
  'BUY',
  'BOUGHT',
  'SOLD',
  'AVOID'
));

-- 2. Create index for fast UI queries
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_lifecycle_state
ON public.vehicle_listings (lifecycle_state);

-- 3. Backfill existing listings with sensible defaults
UPDATE public.vehicle_listings
SET lifecycle_state =
  CASE
    WHEN avoid_reason IS NOT NULL OR sold_returned_suspected = true THEN 'AVOID'
    WHEN watch_status = 'buy_window' THEN 'BUY'
    WHEN watch_status = 'watching' THEN 'WATCH'
    ELSE 'NEW'
  END
WHERE lifecycle_state = 'NEW';