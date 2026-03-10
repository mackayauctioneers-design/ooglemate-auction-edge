
-- Engine aliases: maps raw text patterns to canonical engine_type
CREATE TABLE public.engine_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make text NOT NULL DEFAULT '*',
  model text NOT NULL DEFAULT '*',
  alias text NOT NULL,
  engine_type text NOT NULL,
  fuel_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (make, model, alias)
);

-- Seed with known AU market engine patterns
INSERT INTO public.engine_aliases (make, model, alias, engine_type, fuel_type) VALUES
-- Ford Ranger
('FORD', 'RANGER', 'V6', '3.0 V6 DIESEL', 'DIESEL'),
('FORD', 'RANGER', '3.0', '3.0 V6 DIESEL', 'DIESEL'),
('FORD', 'RANGER', '3.0L', '3.0 V6 DIESEL', 'DIESEL'),
('FORD', 'RANGER', '3.0L V6', '3.0 V6 DIESEL', 'DIESEL'),
('FORD', 'RANGER', '3.0 V6', '3.0 V6 DIESEL', 'DIESEL'),
('FORD', 'RANGER', 'BITURBO', '2.0 BITURBO DIESEL', 'DIESEL'),
('FORD', 'RANGER', 'BI-TURBO', '2.0 BITURBO DIESEL', 'DIESEL'),
('FORD', 'RANGER', 'BI TURBO', '2.0 BITURBO DIESEL', 'DIESEL'),
('FORD', 'RANGER', '2.0', '2.0 BITURBO DIESEL', 'DIESEL'),
('FORD', 'RANGER', '2.0L', '2.0 BITURBO DIESEL', 'DIESEL'),
('FORD', 'RANGER', '2.0 BITURBO', '2.0 BITURBO DIESEL', 'DIESEL'),
('FORD', 'RANGER', '2.0L BITURBO', '2.0 BITURBO DIESEL', 'DIESEL'),
-- Ford Everest
('FORD', 'EVEREST', 'V6', '3.0 V6 DIESEL', 'DIESEL'),
('FORD', 'EVEREST', '3.0', '3.0 V6 DIESEL', 'DIESEL'),
('FORD', 'EVEREST', '3.0 V6', '3.0 V6 DIESEL', 'DIESEL'),
('FORD', 'EVEREST', 'BITURBO', '2.0 BITURBO DIESEL', 'DIESEL'),
('FORD', 'EVEREST', 'BI-TURBO', '2.0 BITURBO DIESEL', 'DIESEL'),
('FORD', 'EVEREST', '2.0', '2.0 BITURBO DIESEL', 'DIESEL'),
('FORD', 'EVEREST', '2.0 BITURBO', '2.0 BITURBO DIESEL', 'DIESEL'),
-- Toyota LandCruiser 300
('TOYOTA', 'LANDCRUISER', '3.3', '3.3 V6 DIESEL', 'DIESEL'),
('TOYOTA', 'LANDCRUISER', '3.3 V6', '3.3 V6 DIESEL', 'DIESEL'),
('TOYOTA', 'LANDCRUISER', '3.3L', '3.3 V6 DIESEL', 'DIESEL'),
('TOYOTA', 'LANDCRUISER', 'V6 DIESEL', '3.3 V6 DIESEL', 'DIESEL'),
('TOYOTA', 'LANDCRUISER', '3.5', '3.5 V6 PETROL', 'PETROL'),
('TOYOTA', 'LANDCRUISER', '3.5 V6', '3.5 V6 PETROL', 'PETROL'),
('TOYOTA', 'LANDCRUISER', 'V6 PETROL', '3.5 V6 PETROL', 'PETROL'),
('TOYOTA', 'LANDCRUISER', '4.5', '4.5 V8 DIESEL', 'DIESEL'),
('TOYOTA', 'LANDCRUISER', 'V8', '4.5 V8 DIESEL', 'DIESEL'),
('TOYOTA', 'LANDCRUISER', '4.6', '4.6 V8 PETROL', 'PETROL'),
-- Toyota Prado
('TOYOTA', 'PRADO', '2.8', '2.8 DIESEL', 'DIESEL'),
('TOYOTA', 'PRADO', '2.8L', '2.8 DIESEL', 'DIESEL'),
('TOYOTA', 'PRADO', '2.8 DIESEL', '2.8 DIESEL', 'DIESEL'),
('TOYOTA', 'PRADO', '2.7', '2.7 PETROL', 'PETROL'),
('TOYOTA', 'PRADO', '2.7L', '2.7 PETROL', 'PETROL'),
('TOYOTA', 'PRADO', '2.4 HYBRID', '2.4 HYBRID', 'HYBRID'),
('TOYOTA', 'PRADO', 'HYBRID', '2.4 HYBRID', 'HYBRID'),
-- Toyota Hilux
('TOYOTA', 'HILUX', '2.8', '2.8 DIESEL', 'DIESEL'),
('TOYOTA', 'HILUX', '2.8L', '2.8 DIESEL', 'DIESEL'),
('TOYOTA', 'HILUX', '2.4', '2.4 DIESEL', 'DIESEL'),
('TOYOTA', 'HILUX', '2.4L', '2.4 DIESEL', 'DIESEL'),
('TOYOTA', 'HILUX', '2.7', '2.7 PETROL', 'PETROL'),
('TOYOTA', 'HILUX', '2.7L', '2.7 PETROL', 'PETROL'),
-- Isuzu D-Max / MU-X
('ISUZU', 'D-MAX', '3.0', '3.0 DIESEL', 'DIESEL'),
('ISUZU', 'D-MAX', '3.0L', '3.0 DIESEL', 'DIESEL'),
('ISUZU', 'D-MAX', '1.9', '1.9 DIESEL', 'DIESEL'),
('ISUZU', 'D-MAX', '1.9L', '1.9 DIESEL', 'DIESEL'),
('ISUZU', 'MU-X', '3.0', '3.0 DIESEL', 'DIESEL'),
('ISUZU', 'MU-X', '1.9', '1.9 DIESEL', 'DIESEL'),
-- Nissan Patrol
('NISSAN', 'PATROL', 'V8', '5.6 V8 PETROL', 'PETROL'),
('NISSAN', 'PATROL', '5.6', '5.6 V8 PETROL', 'PETROL'),
-- Mitsubishi Triton
('MITSUBISHI', 'TRITON', '2.4', '2.4 DIESEL', 'DIESEL'),
('MITSUBISHI', 'TRITON', '2.4L', '2.4 DIESEL', 'DIESEL'),
-- VW Amarok
('VOLKSWAGEN', 'AMAROK', 'TDI580', '3.0 V6 DIESEL', 'DIESEL'),
('VOLKSWAGEN', 'AMAROK', 'TDI550', '3.0 V6 DIESEL', 'DIESEL'),
('VOLKSWAGEN', 'AMAROK', 'TDI420', '2.0 DIESEL', 'DIESEL'),
('VOLKSWAGEN', 'AMAROK', 'V6', '3.0 V6 DIESEL', 'DIESEL'),
('VOLKSWAGEN', 'AMAROK', '3.0', '3.0 V6 DIESEL', 'DIESEL'),
('VOLKSWAGEN', 'AMAROK', '2.0', '2.0 DIESEL', 'DIESEL'),
-- Generic wildcards (catch-all for any make/model)
('*', '*', 'V8', 'V8', NULL),
('*', '*', 'V6', 'V6', NULL),
('*', '*', 'TURBO DIESEL', 'TURBO DIESEL', 'DIESEL'),
('*', '*', 'TWIN TURBO', 'TWIN TURBO', NULL),
('*', '*', 'BITURBO', 'BITURBO', NULL),
('*', '*', 'BI-TURBO', 'BITURBO', NULL),
('*', '*', 'ECOBOOST', 'ECOBOOST', 'PETROL'),
('*', '*', 'HYBRID', 'HYBRID', 'HYBRID');

-- RLS: public read (reference data)
ALTER TABLE public.engine_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "engine_aliases_public_read" ON public.engine_aliases FOR SELECT TO authenticated USING (true);

-- Add engine_type + engine_confidence columns to retail_listings
ALTER TABLE public.retail_listings ADD COLUMN IF NOT EXISTS engine_type text;
ALTER TABLE public.retail_listings ADD COLUMN IF NOT EXISTS engine_confidence text DEFAULT 'LOW';

-- Add engine_type to vehicle_listings
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS engine_type text;
ALTER TABLE public.vehicle_listings ADD COLUMN IF NOT EXISTS engine_confidence text DEFAULT 'LOW';
