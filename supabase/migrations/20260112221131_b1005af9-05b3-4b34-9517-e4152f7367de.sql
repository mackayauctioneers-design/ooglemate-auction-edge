-- 1) Vehicle assignment fields (for BUY_WINDOW workflow)
ALTER TABLE public.vehicle_listings
ADD COLUMN IF NOT EXISTS assigned_to text,
ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
ADD COLUMN IF NOT EXISTS assigned_by uuid,
ADD COLUMN IF NOT EXISTS assignment_notes text;

-- 2) Helpful index for Slack + UI queries
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_buy_window_unassigned
ON public.vehicle_listings (watch_status, assigned_to, buy_window_at)
WHERE watch_status = 'buy_window';