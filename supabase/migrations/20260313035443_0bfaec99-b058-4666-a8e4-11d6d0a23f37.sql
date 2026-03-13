
-- Add demo fields to dealer_profiles
ALTER TABLE public.dealer_profiles 
  ADD COLUMN IF NOT EXISTS dealer_type text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS demo_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demo_query_limit integer NOT NULL DEFAULT 5;

-- Create demo_usage tracking table
CREATE TABLE public.demo_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vehicle_search jsonb,
  clicked_alert boolean DEFAULT false,
  clicked_upload boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.demo_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own demo usage"
  ON public.demo_usage FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own demo usage"
  ON public.demo_usage FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
