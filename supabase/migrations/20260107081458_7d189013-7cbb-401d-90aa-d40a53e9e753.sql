-- Add INSERT/UPDATE policy for fingerprint_outcomes (service role)
CREATE POLICY "Service can manage fingerprint outcomes"
  ON public.fingerprint_outcomes
  FOR ALL
  USING (true)
  WITH CHECK (true);