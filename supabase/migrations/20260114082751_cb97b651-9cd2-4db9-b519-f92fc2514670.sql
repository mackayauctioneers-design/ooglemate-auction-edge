-- Add unique constraint for dedup on sales_triggers
CREATE UNIQUE INDEX IF NOT EXISTS sales_triggers_listing_config_unique 
ON sales_triggers (listing_id, config_version);