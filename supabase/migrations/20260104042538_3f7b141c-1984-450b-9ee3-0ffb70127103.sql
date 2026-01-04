-- Create storage bucket for HTML snapshots
INSERT INTO storage.buckets (id, name, public) 
VALUES ('pickles-snapshots', 'pickles-snapshots', false)
ON CONFLICT (id) DO NOTHING;

-- Allow edge functions to write to this bucket (service role)
CREATE POLICY "Service role can manage pickles snapshots"
ON storage.objects
FOR ALL
USING (bucket_id = 'pickles-snapshots')
WITH CHECK (bucket_id = 'pickles-snapshots');