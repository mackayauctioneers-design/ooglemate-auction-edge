-- =====================================================
-- RELIST V2: Identity-Linked Sold-Returned Detection
-- =====================================================
-- Detects vehicle returns across DIFFERENT listing IDs
-- using identity_id matching within a 14-day window.
-- =====================================================

-- 1) Add columns to track identity-linked returns
ALTER TABLE public.retail_listings
ADD COLUMN IF NOT EXISTS linked_from_listing_id uuid NULL,
ADD COLUMN IF NOT EXISTS linked_reason text NULL;

-- Index for identity lookups on recently delisted
CREATE INDEX IF NOT EXISTS idx_retail_identity_delisted 
ON public.retail_listings (identity_id, lifecycle_status, delisted_at DESC)
WHERE identity_id IS NOT NULL AND lifecycle_status = 'DELISTED';

-- 2) Create helper function to find recent delisted listing by identity_id
CREATE OR REPLACE FUNCTION public.find_recent_delisted_by_identity(
  p_identity_id uuid,
  p_source text,
  p_exclude_listing_id uuid,
  p_window_days int DEFAULT 14
)
RETURNS TABLE (
  listing_id uuid,
  source_listing_id text,
  delisted_at timestamptz,
  anomaly_sold_returned boolean,
  risk_flags text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rl.id,
    rl.source_listing_id,
    rl.delisted_at,
    rl.anomaly_sold_returned,
    rl.risk_flags
  FROM public.retail_listings rl
  WHERE rl.identity_id = p_identity_id
    AND rl.source = p_source
    AND rl.id != p_exclude_listing_id  -- Different listing
    AND rl.lifecycle_status = 'DELISTED'
    AND rl.delisted_at IS NOT NULL
    AND rl.delisted_at >= now() - (p_window_days || ' days')::interval
  ORDER BY rl.delisted_at DESC
  LIMIT 1;
END;
$$;

-- 3) Create RPC to check and flag identity-linked sold-returned on new listings
-- This is called after upsert when identity_id is assigned
CREATE OR REPLACE FUNCTION public.check_identity_linked_sold_returned(
  p_listing_id uuid,
  p_identity_id uuid,
  p_source text,
  p_window_days int DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_delisted record;
  v_inherited_flags text[];
  v_result jsonb;
BEGIN
  -- Already flagged? Skip
  IF EXISTS (
    SELECT 1 FROM public.retail_listings 
    WHERE id = p_listing_id AND anomaly_sold_returned = true
  ) THEN
    RETURN jsonb_build_object('already_flagged', true, 'triggered', false);
  END IF;

  -- Find recent delisted with same identity
  SELECT * INTO v_recent_delisted
  FROM public.find_recent_delisted_by_identity(
    p_identity_id, p_source, p_listing_id, p_window_days
  );
  
  IF NOT FOUND OR v_recent_delisted.listing_id IS NULL THEN
    RETURN jsonb_build_object('triggered', false, 'reason', 'no_recent_match');
  END IF;
  
  -- Found match - flag the new listing
  v_inherited_flags := COALESCE(v_recent_delisted.risk_flags, ARRAY[]::text[]);
  IF NOT ('SOLD_RETURNED' = ANY(v_inherited_flags)) THEN
    v_inherited_flags := array_append(v_inherited_flags, 'SOLD_RETURNED');
  END IF;
  
  UPDATE public.retail_listings SET
    anomaly_sold_returned = true,
    sold_returned_at = now(),
    exclude_from_alerts = true,
    risk_flags = v_inherited_flags,
    linked_from_listing_id = v_recent_delisted.listing_id,
    linked_reason = 'identity_match_within_' || p_window_days || '_days'
  WHERE id = p_listing_id;
  
  v_result := jsonb_build_object(
    'triggered', true,
    'linked_from', v_recent_delisted.listing_id,
    'linked_source_listing_id', v_recent_delisted.source_listing_id,
    'inherited_flags', v_inherited_flags
  );
  
  RETURN v_result;
END;
$$;

-- 4) Create trigger to auto-check on identity assignment
CREATE OR REPLACE FUNCTION public.trigger_check_identity_sold_returned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only run when identity_id is newly assigned (was NULL, now set)
  IF OLD.identity_id IS NULL AND NEW.identity_id IS NOT NULL THEN
    PERFORM public.check_identity_linked_sold_returned(
      NEW.id,
      NEW.identity_id,
      NEW.source,
      14  -- window days
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Drop if exists, then create trigger
DROP TRIGGER IF EXISTS trg_identity_sold_returned ON public.retail_listings;
CREATE TRIGGER trg_identity_sold_returned
  AFTER UPDATE OF identity_id ON public.retail_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_check_identity_sold_returned();