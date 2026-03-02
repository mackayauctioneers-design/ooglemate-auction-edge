
-- Search audit log for commercial-grade traceability
CREATE TABLE public.search_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  dealer_id text,
  raw_query text NOT NULL,
  parsed_intent jsonb NOT NULL DEFAULT '{}',
  tier0_count int NOT NULL DEFAULT 0,
  tier1_count int NOT NULL DEFAULT 0,
  outward_triggered boolean NOT NULL DEFAULT false,
  outward_reason text,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for querying recent searches
CREATE INDEX idx_search_audit_log_created ON public.search_audit_log (created_at DESC);

-- RLS: operator-only read, system insert
ALTER TABLE public.search_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read search audit logs"
  ON public.search_audit_log FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert search audit logs"
  ON public.search_audit_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
