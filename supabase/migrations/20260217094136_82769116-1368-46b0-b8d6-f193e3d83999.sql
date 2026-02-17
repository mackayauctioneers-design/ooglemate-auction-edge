-- Add drivetrain column to winners_watchlist
ALTER TABLE public.winners_watchlist ADD COLUMN IF NOT EXISTS drivetrain text;

-- Update unique constraint to include drivetrain
-- First drop old constraint if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'winners_watchlist_account_id_make_model_variant_key') THEN
    ALTER TABLE public.winners_watchlist DROP CONSTRAINT winners_watchlist_account_id_make_model_variant_key;
  END IF;
END $$;

-- Create new unique constraint with drivetrain
ALTER TABLE public.winners_watchlist ADD CONSTRAINT winners_watchlist_account_make_model_variant_dt_key 
  UNIQUE (account_id, make, model, variant, drivetrain);