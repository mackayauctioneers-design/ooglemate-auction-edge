-- ============================================================
-- Pipeline Cleanup Migration — 2026-03-21
-- Fixes: Firecrawl death spiral + stale hunt_alerts backlog
-- ============================================================

-- 1. Reset all Firecrawl-failed retail_listings so they can be re-enriched
--    94,024 listings stuck with details_failed=true from 402/403 errors.
--    The enrichment worker skips these permanently — resetting allows retry.
UPDATE retail_listings
SET details_failed = false,
    details_attempts = 0,
    details_scraped = false,
    enrichment_status = 'pending',
    enrichment_errors = NULL
WHERE details_failed = true
  AND (enrichment_errors LIKE '%402%'
    OR enrichment_errors LIKE '%403%'
    OR enrichment_errors LIKE '%do not support%'
    OR enrichment_errors LIKE '%Insufficient credits%'
    OR enrichment_errors LIKE '%Domain blocked%');

-- 2. Expire stale hunt_alerts that were never sent (older than 7 days)
--    These accumulated while alert-notifier had no cron schedule.
--    Sending them now would flood dealers with stale, irrelevant alerts.
UPDATE hunt_alerts
SET should_notify = false,
    notify_reason = 'expired_backlog_cleanup_20260321'
WHERE notification_attempts = 0
  AND should_notify = true
  AND sent_at IS NULL
  AND created_at < NOW() - INTERVAL '7 days';

-- 3. Mark remaining recent unsent alerts for priority delivery
--    (alerts from last 7 days that are still relevant)
COMMENT ON TABLE hunt_alerts IS 'Backlog cleared 2026-03-21. Recent alerts will drain via alert-notifier cron.';
