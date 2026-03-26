INSERT INTO public.ingestion_sources (source_key, display_name, cron_schedule, expected_interval_minutes, enabled, min_listings_24h, notes)
VALUES
  ('easyauto-scrape', 'EasyAuto123', NULL, 1440, true, NULL, 'Dealer trap scraper for EasyAuto123 websites'),
  ('caroogle-gumtree-cron', 'Gumtree (Caroogle API)', '0 */2 * * *', 120, true, 100, 'Gumtree listings via Caroogle unified API'),
  ('caroogle-autotrader-cron', 'AutoTrader (Caroogle API)', '0 */2 * * *', 120, true, 100, 'AutoTrader listings via Caroogle unified API')
ON CONFLICT (source_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  cron_schedule = EXCLUDED.cron_schedule,
  expected_interval_minutes = EXCLUDED.expected_interval_minutes,
  enabled = EXCLUDED.enabled,
  min_listings_24h = EXCLUDED.min_listings_24h,
  notes = EXCLUDED.notes,
  updated_at = now();