
INSERT INTO storage.buckets (id, name, public)
VALUES ('pulse-dryrun', 'pulse-dryrun', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "Public read pulse-dryrun"
ON storage.objects FOR SELECT
USING (bucket_id = 'pulse-dryrun');
