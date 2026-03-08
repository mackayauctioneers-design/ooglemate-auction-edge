
-- Fingerprint Performance Metrics table
-- Tracks real-world outcome metrics per fingerprint (platform_class)
CREATE TABLE public.fingerprint_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_class text NOT NULL,
  account_id text,
  matches_detected integer NOT NULL DEFAULT 0,
  matches_reviewed integer NOT NULL DEFAULT 0,
  matches_approved integer NOT NULL DEFAULT 0,
  matches_purchased integer NOT NULL DEFAULT 0,
  matches_closed integer NOT NULL DEFAULT 0,
  matches_profitable integer NOT NULL DEFAULT 0,
  matches_lossmaking integer NOT NULL DEFAULT 0,
  avg_expected_margin numeric DEFAULT 0,
  avg_realized_margin numeric DEFAULT 0,
  avg_days_to_sell numeric DEFAULT 0,
  approval_rate numeric DEFAULT 0,
  purchase_rate numeric DEFAULT 0,
  profit_hit_rate numeric DEFAULT 0,
  false_signal_rate numeric DEFAULT 0,
  fingerprint_accuracy_score numeric DEFAULT 0,
  governance_status text NOT NULL DEFAULT 'active',
  last_recomputed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(platform_class, account_id)
);

-- Index for fast lookups
CREATE INDEX idx_fpm_platform_class ON public.fingerprint_performance_metrics(platform_class);
CREATE INDEX idx_fpm_accuracy_score ON public.fingerprint_performance_metrics(fingerprint_accuracy_score DESC);
CREATE INDEX idx_fpm_governance ON public.fingerprint_performance_metrics(governance_status);

-- RLS: admin only
ALTER TABLE public.fingerprint_performance_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on fingerprint_performance_metrics"
  ON public.fingerprint_performance_metrics
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
