-- Add explicit max_buy_price ceiling to fingerprint_targets
ALTER TABLE fingerprint_targets
  ADD COLUMN IF NOT EXISTS max_buy_price numeric;