UPDATE operator_opportunities
SET status = 'new', updated_at = now()
WHERE listing_source = 'pickles'
  AND status = 'expired'
  AND updated_at > now() - interval '15 minutes'