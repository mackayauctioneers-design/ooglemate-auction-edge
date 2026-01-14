-- Drop and recreate retail_ingest_stats with source breakdown
DROP VIEW IF EXISTS public.retail_ingest_stats;

CREATE OR REPLACE VIEW public.retail_ingest_stats AS
SELECT 
  -- Overall stats
  (SELECT count(*) FROM retail_listings WHERE first_seen_at >= CURRENT_DATE) AS listings_scraped_today,
  (SELECT count(*) FROM retail_listings WHERE delisted_at IS NULL) AS active_listings_total,
  (SELECT count(*) FROM retail_listings WHERE identity_id IS NOT NULL AND delisted_at IS NULL) AS listings_with_identity,
  (SELECT count(*) FROM trigger_evaluations WHERE evaluated_at >= CURRENT_DATE) AS evaluations_today,
  (SELECT count(*) FROM sales_triggers WHERE created_at >= CURRENT_DATE) AS triggers_today,
  (SELECT count(*) FROM sales_triggers WHERE created_at >= CURRENT_DATE AND trigger_type = 'BUY') AS buy_triggers_today,
  (SELECT count(*) FROM sales_triggers WHERE created_at >= CURRENT_DATE AND trigger_type = 'WATCH') AS watch_triggers_today,
  (SELECT ROUND(COUNT(*) FILTER (WHERE identity_id IS NOT NULL)::numeric / NULLIF(COUNT(*), 0)::numeric * 100, 1) FROM retail_listings WHERE delisted_at IS NULL) AS identity_mapping_pct,
  
  -- Source breakdown: Gumtree
  (SELECT count(*) FROM retail_listings WHERE source = 'gumtree' AND delisted_at IS NULL) AS gumtree_active,
  (SELECT count(*) FROM retail_listings WHERE source = 'gumtree' AND first_seen_at >= CURRENT_DATE) AS gumtree_today,
  (SELECT ROUND(COUNT(*) FILTER (WHERE identity_id IS NOT NULL)::numeric / NULLIF(COUNT(*), 0)::numeric * 100, 1) FROM retail_listings WHERE source = 'gumtree' AND delisted_at IS NULL) AS gumtree_identity_pct,
  
  -- Source breakdown: Autotrader
  (SELECT count(*) FROM retail_listings WHERE source = 'autotrader' AND delisted_at IS NULL) AS autotrader_active,
  (SELECT count(*) FROM retail_listings WHERE source = 'autotrader' AND first_seen_at >= CURRENT_DATE) AS autotrader_today,
  (SELECT ROUND(COUNT(*) FILTER (WHERE identity_id IS NOT NULL)::numeric / NULLIF(COUNT(*), 0)::numeric * 100, 1) FROM retail_listings WHERE source = 'autotrader' AND delisted_at IS NULL) AS autotrader_identity_pct,
  
  -- Triggers by source (via listing join)
  (SELECT count(*) FROM sales_triggers st JOIN retail_listings rl ON st.listing_id = rl.id WHERE st.created_at >= CURRENT_DATE AND rl.source = 'gumtree') AS gumtree_triggers_today,
  (SELECT count(*) FROM sales_triggers st JOIN retail_listings rl ON st.listing_id = rl.id WHERE st.created_at >= CURRENT_DATE AND rl.source = 'autotrader') AS autotrader_triggers_today;