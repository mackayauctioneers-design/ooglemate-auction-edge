-- Create storage bucket for VA auction uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('va-auction-uploads', 'va-auction-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for admin-only access
CREATE POLICY "Admin users can upload VA auction files"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'va-auction-uploads' 
  AND EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role IN ('admin', 'internal')
  )
);

CREATE POLICY "Admin users can read VA auction files"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'va-auction-uploads' 
  AND EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role IN ('admin', 'internal')
  )
);

-- VA Upload Batches table
CREATE TABLE public.va_upload_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by UUID REFERENCES auth.users(id),
  source_key TEXT NOT NULL,
  auction_date DATE NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('csv', 'xlsx', 'pdf')),
  file_size_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'parsing', 'parsed', 'ingesting', 'completed', 'failed')),
  parse_started_at TIMESTAMPTZ,
  parse_completed_at TIMESTAMPTZ,
  ingest_started_at TIMESTAMPTZ,
  ingest_completed_at TIMESTAMPTZ,
  rows_total INTEGER DEFAULT 0,
  rows_accepted INTEGER DEFAULT 0,
  rows_rejected INTEGER DEFAULT 0,
  error TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- VA Upload Rows table
CREATE TABLE public.va_upload_rows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES public.va_upload_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Raw parsed data
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Normalized fields
  lot_id TEXT,
  stock_number TEXT,
  vin TEXT,
  year INTEGER,
  make TEXT,
  model TEXT,
  variant_raw TEXT,
  variant_family TEXT,
  km INTEGER,
  fuel TEXT,
  transmission TEXT,
  location TEXT,
  reserve INTEGER,
  asking_price INTEGER,
  
  -- Processing status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  rejection_reason TEXT,
  
  -- Link to created listing
  listing_id UUID REFERENCES public.vehicle_listings(id),
  
  UNIQUE(batch_id, row_number)
);

-- Enable RLS
ALTER TABLE public.va_upload_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.va_upload_rows ENABLE ROW LEVEL SECURITY;

-- RLS policies for admin-only access
CREATE POLICY "Admin users can manage VA batches"
ON public.va_upload_batches FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role IN ('admin', 'internal')
  )
);

CREATE POLICY "Admin users can manage VA rows"
ON public.va_upload_rows FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() 
    AND role IN ('admin', 'internal')
  )
);

-- Indexes for performance
CREATE INDEX idx_va_batches_status ON public.va_upload_batches(status);
CREATE INDEX idx_va_batches_created_at ON public.va_upload_batches(created_at DESC);
CREATE INDEX idx_va_batches_source_key ON public.va_upload_batches(source_key);
CREATE INDEX idx_va_rows_batch_id ON public.va_upload_rows(batch_id);
CREATE INDEX idx_va_rows_status ON public.va_upload_rows(status);