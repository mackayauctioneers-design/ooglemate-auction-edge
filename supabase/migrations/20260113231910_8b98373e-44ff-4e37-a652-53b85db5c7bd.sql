-- Add trap_mode column to dealer_traps
-- Values: 'auto' (site crawl), 'portal' (OEM feed), 'va' (manual), 'dormant' (inactive)
ALTER TABLE public.dealer_traps 
ADD COLUMN IF NOT EXISTS trap_mode text NOT NULL DEFAULT 'auto';

-- Add comment for clarity
COMMENT ON COLUMN public.dealer_traps.trap_mode IS 'Operating mode: auto (site crawl), portal (OEM feed backed), va (manual VA fed), dormant (inactive)';

-- Update existing Toyota dealers to portal mode
UPDATE public.dealer_traps 
SET trap_mode = 'portal'
WHERE LOWER(dealer_name) LIKE '%toyota%' 
  AND trap_mode = 'auto';

-- Update failing traps with franchise patterns to portal mode
UPDATE public.dealer_traps 
SET trap_mode = 'portal'
WHERE (LOWER(dealer_name) LIKE '%toyota%' 
    OR LOWER(dealer_name) LIKE '%mazda%'
    OR LOWER(dealer_name) LIKE '%hyundai%'
    OR LOWER(dealer_name) LIKE '%kia%')
  AND (preflight_status = 'fail' OR consecutive_failures >= 3)
  AND trap_mode = 'auto';

-- Create a view for operational metrics
CREATE OR REPLACE VIEW trap_operational_summary AS
SELECT
  COUNT(*) FILTER (WHERE enabled = true OR trap_mode IN ('portal', 'va')) AS operational_count,
  COUNT(*) FILTER (WHERE enabled = true AND trap_mode = 'auto' AND validation_status = 'validated') AS auto_crawling_count,
  COUNT(*) FILTER (WHERE trap_mode = 'portal') AS portal_backed_count,
  COUNT(*) FILTER (WHERE trap_mode = 'va') AS va_fed_count,
  COUNT(*) FILTER (WHERE trap_mode = 'dormant' OR (enabled = false AND trap_mode = 'auto')) AS dormant_count,
  COUNT(*) AS total_count
FROM public.dealer_traps;