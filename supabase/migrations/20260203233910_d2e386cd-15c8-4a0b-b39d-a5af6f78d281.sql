-- Create snap_id_sessions table for vehicle identification via photo
CREATE TABLE public.snap_id_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,
  user_id UUID,
  
  -- Photo references (storage paths)
  compliance_plate_path TEXT,
  windscreen_vin_path TEXT,
  
  -- Extracted data
  extracted_vin TEXT,
  vin_confidence TEXT CHECK (vin_confidence IN ('high', 'medium', 'low')),
  
  -- Identified vehicle
  identified_make TEXT,
  identified_model TEXT,
  identified_year_min INT,
  identified_year_max INT,
  identified_variant TEXT,
  identified_transmission TEXT,
  identified_fuel_type TEXT,
  identified_body_type TEXT,
  
  -- Intelligence summary
  vehicle_confidence TEXT CHECK (vehicle_confidence IN ('high', 'medium', 'low')),
  known_issues JSONB DEFAULT '[]'::jsonb,
  avoided_issues JSONB DEFAULT '[]'::jsonb,
  why_this_matters TEXT,
  
  -- Raw OCR output for debugging
  ocr_raw JSONB,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.snap_id_sessions ENABLE ROW LEVEL SECURITY;

-- Users can view their own sessions
CREATE POLICY "Users can view own snap_id_sessions"
  ON public.snap_id_sessions FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create sessions
CREATE POLICY "Users can create snap_id_sessions"
  ON public.snap_id_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own sessions
CREATE POLICY "Users can update own snap_id_sessions"
  ON public.snap_id_sessions FOR UPDATE
  USING (auth.uid() = user_id);

-- Admins can view all
CREATE POLICY "Admins can view all snap_id_sessions"
  ON public.snap_id_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.role IN ('admin', 'internal')
    )
  );

-- Create storage bucket for VIN photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'snap-id-photos',
  'snap-id-photos',
  false,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for snap-id-photos bucket
CREATE POLICY "Users can upload snap-id photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'snap-id-photos' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view own snap-id photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'snap-id-photos' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Admins can view all snap-id photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'snap-id-photos'
    AND EXISTS (
      SELECT 1 FROM user_roles 
      WHERE user_roles.user_id = auth.uid() 
      AND user_roles.role IN ('admin', 'internal')
    )
  );

-- Index for quick lookups
CREATE INDEX idx_snap_id_sessions_user ON public.snap_id_sessions(user_id);
CREATE INDEX idx_snap_id_sessions_status ON public.snap_id_sessions(status);
CREATE INDEX idx_snap_id_sessions_vin ON public.snap_id_sessions(extracted_vin) WHERE extracted_vin IS NOT NULL;