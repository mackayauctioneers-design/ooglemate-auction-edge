-- =============================================================================
-- FIX 1: derive_clearance_events - only update status for IDs actually inserted
-- =============================================================================
CREATE OR REPLACE FUNCTION derive_clearance_events(p_stale_hours integer DEFAULT 36)
RETURNS TABLE(listings_processed integer, events_created integer)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_processed int := 0;
  v_created int := 0;
BEGIN
  -- Find stale dealer-grade listings and create clearance events
  -- ONLY update status for the same IDs we insert clearance events for
  WITH stale_dealer_grade AS (
    SELECT l.id, l.last_seen_at, l.first_seen_at, l.status,
           CASE 
             WHEN l.relist_count > 0 THEN 'relisted'
             WHEN l.pass_count > 0 THEN 'passed_in'
             ELSE 'removed'
           END as derived_type
    FROM vehicle_listings l
    WHERE l.status IN ('catalogue', 'listed', 'active')
      AND l.last_seen_at < now() - make_interval(hours => p_stale_hours)
      AND l.is_dealer_grade = true
  ),
  ins AS (
    INSERT INTO clearance_events (listing_id, cleared_at, clearance_type, days_to_clear)
    SELECT
      s.id,
      s.last_seen_at,
      s.derived_type,
      GREATEST(0.1, extract(epoch from (s.last_seen_at - s.first_seen_at)) / 86400.0)
    FROM stale_dealer_grade s
    ON CONFLICT (listing_id, clearance_type, cleared_at) DO NOTHING
    RETURNING listing_id
  ),
  upd AS (
    -- Only update status for listings that got a clearance event inserted
    UPDATE vehicle_listings
    SET status = 'cleared', updated_at = now()
    WHERE id IN (SELECT listing_id FROM ins)
    RETURNING id
  )
  SELECT count(*) INTO v_created FROM ins;
  
  SELECT count(*) INTO v_processed FROM stale_dealer_grade;

  RETURN QUERY SELECT v_processed, v_created;
END;
$$;

-- =============================================================================
-- FIX 2: compute_dealer_grade - require price for classifieds, allow NULL for auctions
-- Add source_class parameter to make function source-aware
-- =============================================================================
CREATE OR REPLACE FUNCTION compute_dealer_grade(
  p_year integer,
  p_asking_price integer,
  p_reserve integer,
  p_excluded_keyword text,
  p_excluded_reason text,
  p_source_class text DEFAULT 'auction',
  p_price_min integer DEFAULT 3000,
  p_price_max integer DEFAULT 150000
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT 
    -- Year gate: 2016+
    coalesce(p_year, 0) >= 2016
    -- Price band logic: source_class-aware
    AND CASE
      -- Classifieds MUST have a valid asking_price
      WHEN p_source_class = 'classifieds' THEN
        coalesce(p_asking_price, 0) BETWEEN p_price_min AND p_price_max
      -- Auctions: require price if present, allow NULL (early catalogue)
      ELSE
        (coalesce(p_reserve, 0) BETWEEN p_price_min AND p_price_max)
        OR (p_reserve IS NULL)  -- Allow early catalogue without reserve
    END
    -- No exclusion keywords
    AND p_excluded_keyword IS NULL
    AND p_excluded_reason IS NULL;
$$;

-- =============================================================================
-- Update trigger to pass source_class
-- =============================================================================
CREATE OR REPLACE FUNCTION set_dealer_grade()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_dealer_grade := compute_dealer_grade(
    NEW.year,
    NEW.asking_price,
    NEW.reserve,
    NEW.excluded_keyword,
    NEW.excluded_reason,
    NEW.source_class,  -- Pass source_class for price logic
    3000,
    150000
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path TO 'public';

-- =============================================================================
-- Re-backfill all listings with source_class-aware logic
-- =============================================================================
UPDATE vehicle_listings
SET is_dealer_grade = compute_dealer_grade(
  year, asking_price, reserve, excluded_keyword, excluded_reason, 
  source_class, 3000, 150000
);