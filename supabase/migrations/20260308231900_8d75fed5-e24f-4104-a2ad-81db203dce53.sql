
ALTER TABLE public.dealer_demands
  ADD COLUMN IF NOT EXISTS series text,
  ADD COLUMN IF NOT EXISTS body_type text,
  ADD COLUMN IF NOT EXISTS variant text,
  ADD COLUMN IF NOT EXISTS fuel text,
  ADD COLUMN IF NOT EXISTS transmission text,
  ADD COLUMN IF NOT EXISTS drivetrain text,
  ADD COLUMN IF NOT EXISTS keywords text,
  ADD COLUMN IF NOT EXISTS auction_only boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dealer_only boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ex_fleet_allowed boolean DEFAULT true;
