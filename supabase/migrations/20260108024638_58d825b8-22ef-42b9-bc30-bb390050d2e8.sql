-- Add failure telemetry columns to dealer_rooftops
ALTER TABLE public.dealer_rooftops
ADD COLUMN IF NOT EXISTS last_fail_reason text,
ADD COLUMN IF NOT EXISTS last_fail_at timestamptz,
ADD COLUMN IF NOT EXISTS last_preflight_markers jsonb;

-- Add comment for clarity
COMMENT ON COLUMN public.dealer_rooftops.last_fail_reason IS 'Last failure reason: dns_failure, http_error, no_inventory_markers, timeout, parse_error, etc.';
COMMENT ON COLUMN public.dealer_rooftops.last_fail_at IS 'Timestamp of last failure';
COMMENT ON COLUMN public.dealer_rooftops.last_preflight_markers IS 'Preflight marker detection results: {dataStocknumber, stockListItemView, vehiclePath}';