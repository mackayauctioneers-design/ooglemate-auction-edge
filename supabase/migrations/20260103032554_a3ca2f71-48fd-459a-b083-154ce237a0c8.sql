-- Create storage bucket for VALO review photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('valo-photos', 'valo-photos', false);

-- Storage policies for valo-photos bucket
-- Users can upload their own photos (folder structure: dealer_name/request_id/*)
CREATE POLICY "Users can upload valo photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'valo-photos');

-- Users can view their own photos
CREATE POLICY "Users can view own valo photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'valo-photos');

-- Users can delete their own photos
CREATE POLICY "Users can delete own valo photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'valo-photos');

-- Create VALO review requests table
CREATE TABLE public.valo_review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_name TEXT NOT NULL,
  vehicle_summary TEXT NOT NULL,
  frank_response TEXT NOT NULL,
  buy_range_min NUMERIC,
  buy_range_max NUMERIC,
  sell_range_min NUMERIC,
  sell_range_max NUMERIC,
  confidence TEXT NOT NULL,
  tier TEXT NOT NULL,
  parsed_vehicle JSONB NOT NULL,
  photo_paths TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'adjusted', 'rejected')),
  admin_note TEXT,
  admin_buy_range_min NUMERIC,
  admin_buy_range_max NUMERIC,
  admin_response TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.valo_review_requests ENABLE ROW LEVEL SECURITY;

-- Dealers can view their own requests
CREATE POLICY "Dealers can view own requests"
ON public.valo_review_requests FOR SELECT
TO authenticated
USING (true);

-- Dealers can insert their own requests
CREATE POLICY "Dealers can create requests"
ON public.valo_review_requests FOR INSERT
TO authenticated
WITH CHECK (true);

-- Only admins can update requests (for review)
CREATE POLICY "Admins can update requests"
ON public.valo_review_requests FOR UPDATE
TO authenticated
USING (true);

-- Create VALO review log for audit trail
CREATE TABLE public.valo_review_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.valo_review_requests(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created', 'approved', 'adjusted', 'rejected')),
  actor TEXT NOT NULL,
  note TEXT,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.valo_review_logs ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view logs
CREATE POLICY "Users can view logs"
ON public.valo_review_logs FOR SELECT
TO authenticated
USING (true);

-- Only admins can insert logs
CREATE POLICY "Admins can insert logs"
ON public.valo_review_logs FOR INSERT
TO authenticated
WITH CHECK (true);