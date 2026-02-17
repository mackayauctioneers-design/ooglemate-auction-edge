
-- Create trim ladder lookup table
CREATE TABLE public.trim_ladder (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  trim_class TEXT NOT NULL,
  trim_rank INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(make, model, trim_class)
);

-- Enable RLS
ALTER TABLE public.trim_ladder ENABLE ROW LEVEL SECURITY;

-- Public read access (reference data)
CREATE POLICY "Trim ladder is publicly readable"
  ON public.trim_ladder FOR SELECT USING (true);

-- Seed trim ladders for top models
INSERT INTO public.trim_ladder (make, model, trim_class, trim_rank) VALUES
-- LandCruiser 70
('TOYOTA', 'LANDCRUISER', 'LC70_BASE', 1),
('TOYOTA', 'LANDCRUISER', 'LC70_GX', 2),
('TOYOTA', 'LANDCRUISER', 'LC70_GXL', 3),
('TOYOTA', 'LANDCRUISER', 'LC70_VX', 4),
('TOYOTA', 'LANDCRUISER', 'LC70_SAHARA', 5),
('TOYOTA', 'LANDCRUISER', 'LC70_SPECIAL', 6),
-- LandCruiser 200
('TOYOTA', 'LANDCRUISER 200', 'LC200_GX', 1),
('TOYOTA', 'LANDCRUISER 200', 'LC200_GXL', 2),
('TOYOTA', 'LANDCRUISER 200', 'LC200_VX', 3),
('TOYOTA', 'LANDCRUISER 200', 'LC200_SAHARA', 4),
-- LandCruiser 300
('TOYOTA', 'LANDCRUISER 300', 'LC300_GX', 1),
('TOYOTA', 'LANDCRUISER 300', 'LC300_GXL', 2),
('TOYOTA', 'LANDCRUISER 300', 'LC300_VX', 3),
('TOYOTA', 'LANDCRUISER 300', 'LC300_SAHARA', 4),
-- Prado
('TOYOTA', 'PRADO', 'PRADO_GX', 1),
('TOYOTA', 'PRADO', 'PRADO_GXL', 2),
('TOYOTA', 'PRADO', 'PRADO_VX', 3),
('TOYOTA', 'PRADO', 'PRADO_KAKADU', 4),
-- Hilux
('TOYOTA', 'HILUX', 'HILUX_BASE', 1),
('TOYOTA', 'HILUX', 'HILUX_SR', 2),
('TOYOTA', 'HILUX', 'HILUX_SR5', 3),
('TOYOTA', 'HILUX', 'HILUX_ROGUE', 4),
('TOYOTA', 'HILUX', 'HILUX_RUGGED', 5),
-- HiAce
('TOYOTA', 'HIACE', 'HIACE_LWB', 1),
('TOYOTA', 'HIACE', 'HIACE_SLWB', 2),
('TOYOTA', 'HIACE', 'HIACE_COMMUTER', 3),
-- Ranger
('FORD', 'RANGER', 'RANGER_XL', 1),
('FORD', 'RANGER', 'RANGER_XLS', 2),
('FORD', 'RANGER', 'RANGER_XLT', 3),
('FORD', 'RANGER', 'RANGER_WILDTRAK', 4),
('FORD', 'RANGER', 'RANGER_RAPTOR', 5),
-- Everest
('FORD', 'EVEREST', 'EVEREST_AMBIENTE', 1),
('FORD', 'EVEREST', 'EVEREST_TREND', 2),
('FORD', 'EVEREST', 'EVEREST_TITANIUM', 3),
-- D-Max
('ISUZU', 'D-MAX', 'DMAX_SX', 1),
('ISUZU', 'D-MAX', 'DMAX_LSM', 2),
('ISUZU', 'D-MAX', 'DMAX_LSU', 3),
('ISUZU', 'D-MAX', 'DMAX_XTERRAIN', 4),
-- MU-X
('ISUZU', 'MU-X', 'MUX_LSM', 1),
('ISUZU', 'MU-X', 'MUX_LSU', 2),
('ISUZU', 'MU-X', 'MUX_LST', 3),
-- Triton
('MITSUBISHI', 'TRITON', 'TRITON_GLX', 1),
('MITSUBISHI', 'TRITON', 'TRITON_GLXPLUS', 2),
('MITSUBISHI', 'TRITON', 'TRITON_GLS', 3),
-- Navara
('NISSAN', 'NAVARA', 'NAVARA_SL', 1),
('NISSAN', 'NAVARA', 'NAVARA_ST', 2),
('NISSAN', 'NAVARA', 'NAVARA_STL', 3),
('NISSAN', 'NAVARA', 'NAVARA_STX', 4),
('NISSAN', 'NAVARA', 'NAVARA_PRO4X', 5),
-- Patrol
('NISSAN', 'PATROL', 'PATROL_TI', 1),
('NISSAN', 'PATROL', 'PATROL_TIL', 2);
