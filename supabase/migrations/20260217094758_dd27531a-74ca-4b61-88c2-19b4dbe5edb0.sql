-- Add median_km column to winners_watchlist
ALTER TABLE public.winners_watchlist ADD COLUMN IF NOT EXISTS median_km integer;