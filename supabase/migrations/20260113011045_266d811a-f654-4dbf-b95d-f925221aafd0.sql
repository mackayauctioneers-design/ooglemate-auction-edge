-- Ensure v2 fingerprint columns exist (safe if already present)
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS fingerprint_version INT,
  ADD COLUMN IF NOT EXISTS fingerprint_confidence INT,
  ADD COLUMN IF NOT EXISTS variant_source TEXT,
  ADD COLUMN IF NOT EXISTS variant_used TEXT;