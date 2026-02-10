
-- Table: scan_guides — stores each Screenshot → Guide session
CREATE TABLE public.scan_guides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  user_id UUID NOT NULL,
  image_path TEXT,
  image_type TEXT DEFAULT 'screenshot', -- 'screenshot' or 'photo'
  
  -- Extracted identity fields
  extracted_fields JSONB DEFAULT '{}'::jsonb,
  extracted_make TEXT,
  extracted_model TEXT,
  extracted_variant TEXT,
  extracted_year INTEGER,
  extracted_km INTEGER,
  extracted_price INTEGER,
  extracted_source TEXT,
  identity_confirmed BOOLEAN DEFAULT false,
  
  -- Guide outputs
  sales_truth_summary JSONB DEFAULT '{}'::jsonb,
  supply_context_summary JSONB DEFAULT '{}'::jsonb,
  guide_summary JSONB DEFAULT '{}'::jsonb,
  
  -- Confidence
  confidence TEXT DEFAULT 'low' CHECK (confidence IN ('high', 'medium', 'low')),
  identity_confidence TEXT DEFAULT 'low',
  sales_depth_confidence TEXT DEFAULT 'low',
  supply_coverage_confidence TEXT DEFAULT 'low',
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'identifying', 'confirmed', 'guiding', 'completed', 'failed')),
  error TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.scan_guides ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own scan guides"
ON public.scan_guides FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create scan guides"
ON public.scan_guides FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scan guides"
ON public.scan_guides FOR UPDATE
USING (auth.uid() = user_id);

-- Index for account scoping
CREATE INDEX idx_scan_guides_account ON public.scan_guides(account_id);
CREATE INDEX idx_scan_guides_user ON public.scan_guides(user_id);

-- Storage bucket for scan guide screenshots
INSERT INTO storage.buckets (id, name, public) 
VALUES ('scan-guide-photos', 'scan-guide-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Users can upload scan guide photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'scan-guide-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view their scan guide photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'scan-guide-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
