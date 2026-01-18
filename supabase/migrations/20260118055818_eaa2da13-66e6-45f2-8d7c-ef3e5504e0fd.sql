-- Add missing columns to hunt_unified_candidates
ALTER TABLE public.hunt_unified_candidates
ADD COLUMN IF NOT EXISTS source_key TEXT,
ADD COLUMN IF NOT EXISTS source_tier INT DEFAULT 3,
ADD COLUMN IF NOT EXISTS asking_price INT,
ADD COLUMN IF NOT EXISTS km INT,
ADD COLUMN IF NOT EXISTS year INT;