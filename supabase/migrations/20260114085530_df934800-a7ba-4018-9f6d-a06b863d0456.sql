-- Add lock columns to retail_seed_cursor
ALTER TABLE retail_seed_cursor 
ADD COLUMN IF NOT EXISTS locked_until timestamptz,
ADD COLUMN IF NOT EXISTS lock_token text,
ADD COLUMN IF NOT EXISTS last_done_log_at timestamptz;