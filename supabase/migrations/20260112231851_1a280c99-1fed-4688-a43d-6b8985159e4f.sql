-- Create listing_events table for audit trail
CREATE TABLE public.listing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('FIRST_SEEN', 'STILL_ACTIVE', 'WENT_MISSING', 'RETURNED', 'PRICE_CHANGED', 'STATUS_CHANGED')),
  event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_id UUID,
  previous_status TEXT,
  new_status TEXT,
  previous_price INTEGER,
  new_price INTEGER,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient queries
CREATE INDEX idx_listing_events_listing_id ON public.listing_events(listing_id);
CREATE INDEX idx_listing_events_event_type ON public.listing_events(event_type);
CREATE INDEX idx_listing_events_event_at ON public.listing_events(event_at DESC);
CREATE INDEX idx_listing_events_run_id ON public.listing_events(run_id);

-- Enable RLS
ALTER TABLE public.listing_events ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admins can view listing events"
ON public.listing_events FOR SELECT
USING (is_admin_or_internal());

CREATE POLICY "Service can manage listing events"
ON public.listing_events FOR ALL
USING (true)
WITH CHECK (true);

-- Function to derive presence events after a pipeline run
CREATE OR REPLACE FUNCTION public.derive_presence_events(p_run_id UUID, p_source TEXT DEFAULT NULL, p_stale_hours INTEGER DEFAULT 36)
RETURNS TABLE(
  new_listings INTEGER,
  still_active INTEGER,
  went_missing INTEGER,
  returned INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new INT := 0;
  v_active INT := 0;
  v_missing INT := 0;
  v_returned INT := 0;
  v_cutoff TIMESTAMPTZ;
BEGIN
  v_cutoff := now() - make_interval(hours => p_stale_hours);

  -- 1. Mark NEW: listings first seen in this run (within last hour)
  WITH new_listings AS (
    INSERT INTO listing_events (listing_id, event_type, run_id, meta)
    SELECT id, 'FIRST_SEEN', p_run_id, jsonb_build_object('source', source)
    FROM vehicle_listings
    WHERE first_seen_at > now() - INTERVAL '1 hour'
      AND (p_source IS NULL OR source = p_source)
      AND NOT EXISTS (
        SELECT 1 FROM listing_events le
        WHERE le.listing_id = vehicle_listings.id AND le.event_type = 'FIRST_SEEN'
      )
    RETURNING listing_id
  )
  SELECT COUNT(*) INTO v_new FROM new_listings;

  -- 2. WENT_MISSING: was active, now stale (not seen recently)
  WITH missing AS (
    UPDATE vehicle_listings vl
    SET status = 'cleared',
        updated_at = now()
    WHERE vl.status IN ('catalogue', 'listed', 'active')
      AND vl.last_seen_at < v_cutoff
      AND vl.is_dealer_grade = true
      AND (p_source IS NULL OR vl.source = p_source)
    RETURNING vl.id, vl.source
  ),
  logged AS (
    INSERT INTO listing_events (listing_id, event_type, run_id, previous_status, new_status, meta)
    SELECT m.id, 'WENT_MISSING', p_run_id, 'active', 'cleared', jsonb_build_object('source', m.source)
    FROM missing m
    RETURNING listing_id
  )
  SELECT COUNT(*) INTO v_missing FROM logged;

  -- 3. RETURNED: was cleared/inactive, now seen again recently
  WITH returned AS (
    SELECT vl.id, vl.source
    FROM vehicle_listings vl
    WHERE vl.last_seen_at > now() - INTERVAL '2 hours'
      AND vl.relist_count > 0
      AND (p_source IS NULL OR vl.source = p_source)
      AND NOT EXISTS (
        SELECT 1 FROM listing_events le
        WHERE le.listing_id = vl.id
          AND le.event_type = 'RETURNED'
          AND le.event_at > now() - INTERVAL '24 hours'
      )
  ),
  logged AS (
    INSERT INTO listing_events (listing_id, event_type, run_id, meta)
    SELECT r.id, 'RETURNED', p_run_id, jsonb_build_object('source', r.source, 'relist_detected', true)
    FROM returned r
    RETURNING listing_id
  )
  SELECT COUNT(*) INTO v_returned FROM logged;

  -- 4. Count still active (for reporting only, don't log every one)
  SELECT COUNT(*) INTO v_active
  FROM vehicle_listings
  WHERE status IN ('catalogue', 'listed', 'active')
    AND last_seen_at >= v_cutoff
    AND (p_source IS NULL OR source = p_source);

  RETURN QUERY SELECT v_new, v_active, v_missing, v_returned;
END;
$$;