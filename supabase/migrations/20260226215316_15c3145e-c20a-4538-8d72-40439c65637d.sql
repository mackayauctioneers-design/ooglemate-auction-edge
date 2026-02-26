
-- mandate_alerts: Code Red alert log
CREATE TABLE public.mandate_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id uuid NOT NULL,
  source text NOT NULL,
  listing_id text NOT NULL,
  alert_type text NOT NULL,       -- 'price_drop' | 'new_clean'
  severity text NOT NULL,          -- always 'code_red' for now
  reason text NOT NULL,
  reason_json jsonb,
  created_at timestamptz DEFAULT now(),
  sent_at timestamptz,
  is_dismissed boolean DEFAULT false
);

-- Unique constraint for dedup + cooldown
CREATE UNIQUE INDEX mandate_alerts_unique
  ON public.mandate_alerts (mandate_id, source, listing_id, alert_type);

-- No RLS needed: single-operator, only edge function writes
ALTER TABLE public.mandate_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on mandate_alerts"
  ON public.mandate_alerts FOR ALL
  USING (true) WITH CHECK (true);
