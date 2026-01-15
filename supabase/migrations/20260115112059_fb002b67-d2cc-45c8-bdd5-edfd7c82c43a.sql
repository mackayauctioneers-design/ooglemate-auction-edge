-- 1. Create atomic RPC for raw payload upsert with proper times_seen increment
CREATE OR REPLACE FUNCTION public.autotrader_raw_seen(
  p_source_listing_id text,
  p_payload jsonb,
  p_price numeric
)
RETURNS TABLE(is_new boolean, times_seen_now integer) 
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_times_seen integer;
BEGIN
  -- Try to find existing record
  SELECT id, autotrader_raw_payloads.times_seen INTO v_existing_id, v_times_seen
  FROM autotrader_raw_payloads
  WHERE autotrader_raw_payloads.source_listing_id = p_source_listing_id;
  
  IF v_existing_id IS NULL THEN
    -- Insert new record
    INSERT INTO autotrader_raw_payloads (
      source_listing_id,
      payload,
      price_at_first_seen,
      price_at_last_seen,
      first_seen_at,
      last_seen_at,
      times_seen
    ) VALUES (
      p_source_listing_id,
      p_payload,
      p_price,
      p_price,
      now(),
      now(),
      1
    );
    RETURN QUERY SELECT true::boolean, 1::integer;
  ELSE
    -- Update existing record, increment times_seen
    UPDATE autotrader_raw_payloads
    SET 
      payload = p_payload,
      price_at_last_seen = p_price,
      last_seen_at = now(),
      times_seen = autotrader_raw_payloads.times_seen + 1
    WHERE autotrader_raw_payloads.source_listing_id = p_source_listing_id;
    
    RETURN QUERY SELECT false::boolean, (v_times_seen + 1)::integer;
  END IF;
END;
$$;

-- 2. Create cursor table for deterministic crawling
CREATE TABLE IF NOT EXISTS public.autotrader_crawl_cursor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make text NOT NULL,
  state text NOT NULL,
  last_page_crawled integer NOT NULL DEFAULT 0,
  total_pages_estimated integer,
  last_run_at timestamptz,
  last_listings_found integer DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- pending, in_progress, exhausted, error
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(make, state)
);

-- Enable RLS
ALTER TABLE public.autotrader_crawl_cursor ENABLE ROW LEVEL SECURITY;

-- Service role policy (for edge functions)
CREATE POLICY "Service role full access to crawl cursor"
ON public.autotrader_crawl_cursor
FOR ALL
USING (true)
WITH CHECK (true);

-- 3. Create RPC to claim next crawl batch (atomic lock)
CREATE OR REPLACE FUNCTION public.claim_autotrader_crawl_batch(
  p_batch_size integer DEFAULT 5
)
RETURNS TABLE(
  cursor_id uuid,
  make text,
  state text,
  next_page integer
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT ac.id, ac.make, ac.state, ac.last_page_crawled
    FROM autotrader_crawl_cursor ac
    WHERE ac.status IN ('pending', 'exhausted') -- exhausted can be recrawled
      OR (ac.status = 'in_progress' AND ac.last_run_at < now() - interval '10 minutes') -- stale lock
    ORDER BY 
      CASE WHEN ac.status = 'pending' THEN 0 ELSE 1 END, -- prioritize pending
      ac.last_run_at NULLS FIRST -- oldest first
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE autotrader_crawl_cursor c
  SET 
    status = 'in_progress',
    last_run_at = now(),
    updated_at = now()
  FROM claimed
  WHERE c.id = claimed.id
  RETURNING c.id, c.make, c.state, c.last_page_crawled + 1;
END;
$$;

-- 4. Create RPC to update cursor after crawl
CREATE OR REPLACE FUNCTION public.update_autotrader_crawl_cursor(
  p_cursor_id uuid,
  p_page_crawled integer,
  p_listings_found integer,
  p_has_more boolean,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE autotrader_crawl_cursor
  SET 
    last_page_crawled = p_page_crawled,
    last_listings_found = p_listings_found,
    last_run_at = now(),
    status = CASE 
      WHEN p_error IS NOT NULL THEN 'error'
      WHEN NOT p_has_more THEN 'exhausted'
      ELSE 'pending' -- more pages to crawl
    END,
    error_message = p_error,
    updated_at = now()
  WHERE id = p_cursor_id;
END;
$$;

-- 5. Seed the cursor table with make/state combinations
INSERT INTO autotrader_crawl_cursor (make, state, status)
SELECT m.make, s.state, 'pending'
FROM (VALUES 
  ('Toyota'), ('Mazda'), ('Honda'), ('Hyundai'), ('Kia'),
  ('Mitsubishi'), ('Nissan'), ('Subaru'), ('Ford'), ('Volkswagen'),
  ('BMW'), ('Mercedes-Benz'), ('Audi'), ('Lexus')
) AS m(make)
CROSS JOIN (VALUES 
  ('NSW'), ('VIC'), ('QLD'), ('SA'), ('WA')
) AS s(state)
ON CONFLICT (make, state) DO NOTHING;

-- 6. Add index for efficient cursor queries
CREATE INDEX IF NOT EXISTS idx_autotrader_crawl_cursor_status_run
ON autotrader_crawl_cursor(status, last_run_at);

-- 7. Add updated_at trigger
CREATE TRIGGER update_autotrader_crawl_cursor_updated_at
BEFORE UPDATE ON public.autotrader_crawl_cursor
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();