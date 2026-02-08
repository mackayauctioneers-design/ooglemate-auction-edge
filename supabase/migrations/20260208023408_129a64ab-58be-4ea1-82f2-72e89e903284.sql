
-- Create the sales-uploads storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('sales-uploads', 'sales-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Allow service role (edge functions) to read files
CREATE POLICY "Service role can read sales uploads"
ON storage.objects FOR SELECT
USING (bucket_id = 'sales-uploads');

-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload sales files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'sales-uploads' AND auth.role() = 'authenticated');

-- Allow authenticated users to read their uploads
CREATE POLICY "Authenticated users can read sales uploads"
ON storage.objects FOR SELECT
USING (bucket_id = 'sales-uploads' AND auth.role() = 'authenticated');
