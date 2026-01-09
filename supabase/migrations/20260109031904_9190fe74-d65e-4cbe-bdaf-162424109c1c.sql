-- Add preflight status fields to dealer_traps
ALTER TABLE public.dealer_traps 
ADD COLUMN IF NOT EXISTS preflight_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS preflight_reason text,
ADD COLUMN IF NOT EXISTS preflight_checked_at timestamptz;

-- Add index for preflight queries
CREATE INDEX IF NOT EXISTS idx_dealer_traps_preflight_status ON public.dealer_traps(preflight_status);

-- Add comment for documentation
COMMENT ON COLUMN public.dealer_traps.preflight_status IS 'pending, pass, fail';
COMMENT ON COLUMN public.dealer_traps.preflight_reason IS 'Reason for preflight failure or pass details';
COMMENT ON COLUMN public.dealer_traps.preflight_checked_at IS 'When preflight was last checked';