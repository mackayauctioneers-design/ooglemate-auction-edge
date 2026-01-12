-- Add new fields to va_upload_batches
ALTER TABLE public.va_upload_batches 
ADD COLUMN IF NOT EXISTS pdf_extract_required boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS pdf_extract_notes text NULL;

-- Create va_sources table for dropdown (prevents typos)
CREATE TABLE IF NOT EXISTS public.va_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  source_type text NOT NULL DEFAULT 'auction_manual',
  location_hint text,
  enabled boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.va_sources ENABLE ROW LEVEL SECURITY;

-- Admin-only policies
CREATE POLICY "Admin can view va_sources" ON public.va_sources
  FOR SELECT USING (is_admin_or_internal());

CREATE POLICY "Admin can insert va_sources" ON public.va_sources
  FOR INSERT WITH CHECK (is_admin_or_internal());

CREATE POLICY "Admin can update va_sources" ON public.va_sources
  FOR UPDATE USING (is_admin_or_internal());

-- Seed initial VA sources
INSERT INTO public.va_sources (source_key, display_name, source_type, location_hint, enabled) VALUES
  ('slattery_motor_vehicles', 'Slattery Auctions (Motor Vehicles)', 'auction_manual', 'NATIONAL', true),
  ('valley_auto', 'Valley Auto Auctions', 'auction_manual', 'NSW', true),
  ('fowles_sydney', 'Fowles Auctions Sydney', 'auction_manual', 'NSW_SYDNEY_METRO', true),
  ('manheim_sydney', 'Manheim Sydney', 'auction_manual', 'NSW_SYDNEY_METRO', true),
  ('pickles_sydney', 'Pickles Sydney', 'auction_manual', 'NSW_SYDNEY_METRO', true),
  ('pickles_melbourne', 'Pickles Melbourne', 'auction_manual', 'VIC_MELBOURNE', true),
  ('pickles_brisbane', 'Pickles Brisbane', 'auction_manual', 'QLD_BRISBANE', true),
  ('bidsonline_generic', 'BidsOnline (Generic)', 'auction_manual', 'NATIONAL', true),
  ('grays_online', 'Grays Online', 'auction_manual', 'NATIONAL', true),
  ('other_manual', 'Other (Manual Entry)', 'auction_manual', 'UNKNOWN', true)
ON CONFLICT (source_key) DO NOTHING;

-- Update trigger for va_sources
CREATE TRIGGER update_va_sources_updated_at
  BEFORE UPDATE ON public.va_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();