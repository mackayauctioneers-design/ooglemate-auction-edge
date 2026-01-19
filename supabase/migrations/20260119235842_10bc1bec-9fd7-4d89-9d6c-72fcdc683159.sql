-- Create generic upsert_harvest_batch RPC that accepts p_source
-- This replaces the need for source-specific RPCs (pickles, vma, f3, etc.)

CREATE OR REPLACE FUNCTION public.upsert_harvest_batch(
  p_source text,
  p_items jsonb,
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
  v_updated int := 0;
BEGIN
  WITH incoming AS (
    SELECT
      p_source::text AS source,
      (x->>'source_listing_id')::text AS source_listing_id,
      (x->>'detail_url')::text AS detail_url,
      (x->>'search_url')::text AS search_url,
      NULLIF(x->>'page_no','')::int AS page_no
    FROM jsonb_array_elements(p_items) x
    WHERE (x ? 'source_listing_id') AND (x ? 'detail_url')
  ),
  upserted AS (
    INSERT INTO public.pickles_detail_queue (
      source,
      source_listing_id,
      detail_url,
      search_url,
      page_no,
      run_id,
      crawl_status,
      first_seen_at,
      last_seen_at
    )
    SELECT
      source,
      source_listing_id,
      detail_url,
      search_url,
      page_no,
      p_run_id,
      'pending',
      now(),
      now()
    FROM incoming
    ON CONFLICT (source, source_listing_id) DO UPDATE
      SET detail_url = EXCLUDED.detail_url,
          search_url = COALESCE(EXCLUDED.search_url, public.pickles_detail_queue.search_url),
          page_no = COALESCE(EXCLUDED.page_no, public.pickles_detail_queue.page_no),
          last_seen_at = now(),
          -- Reactivate failed/stale rows when re-seen
          crawl_status = CASE 
            WHEN public.pickles_detail_queue.crawl_status IN ('failed', 'stale') THEN 'pending'
            ELSE public.pickles_detail_queue.crawl_status
          END
    RETURNING (xmax = 0) AS inserted_flag
  )
  SELECT
    COALESCE(SUM(CASE WHEN inserted_flag THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN inserted_flag THEN 0 ELSE 1 END), 0)
  INTO v_inserted, v_updated
  FROM upserted;

  RETURN jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
END;
$$;