ALTER TABLE public.winners_watchlist 
  ADD COLUMN IF NOT EXISTS avg_km integer,
  ADD COLUMN IF NOT EXISTS km_band_low integer,
  ADD COLUMN IF NOT EXISTS km_band_high integer;