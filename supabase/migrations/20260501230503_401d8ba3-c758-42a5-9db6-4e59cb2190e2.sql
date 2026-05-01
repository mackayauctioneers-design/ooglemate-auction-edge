
CREATE TABLE IF NOT EXISTS public.pulse_alerts (
  id BIGSERIAL PRIMARY KEY,
  listing_id TEXT NOT NULL,
  family_key TEXT,
  source TEXT,
  status TEXT,
  candidate_price NUMERIC,
  cheapest_peer NUMERIC,
  median_peer NUMERIC,
  peer_count INT,
  gap_to_cheapest NUMERIC,
  gap_to_median NUMERIC,
  composite_score NUMERIC,
  reasoning_json JSONB,
  alerted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decision TEXT,
  decided_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pulse_alerts_listing ON public.pulse_alerts(listing_id, alerted_at DESC);
CREATE INDEX IF NOT EXISTS idx_pulse_alerts_alerted ON public.pulse_alerts(alerted_at DESC);

CREATE TABLE IF NOT EXISTS public.pulse_unmatched_models (
  id BIGSERIAL PRIMARY KEY,
  make TEXT,
  model TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurrence_count INT NOT NULL DEFAULT 1,
  reviewed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(make, model)
);

CREATE TABLE IF NOT EXISTS public.pulse_health_log (
  id BIGSERIAL PRIMARY KEY,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  script TEXT NOT NULL,
  rows_scanned INT,
  alerts_emitted INT,
  errors_seen INT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_pulse_health_ran ON public.pulse_health_log(ran_at DESC);

CREATE TABLE IF NOT EXISTS public.pulse_audit (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_kind TEXT NOT NULL,
  op TEXT NOT NULL,
  request_id TEXT,
  params_json JSONB,
  response_status INT,
  response_ms INT,
  caller_ip TEXT,
  error_text TEXT,
  cached_response JSONB
);
CREATE INDEX IF NOT EXISTS idx_pulse_audit_op_req ON public.pulse_audit(op, request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pulse_audit_created ON public.pulse_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pulse_audit_token_created ON public.pulse_audit(token_kind, created_at DESC);

ALTER TABLE public.pulse_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_unmatched_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_health_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_audit ENABLE ROW LEVEL SECURITY;

-- Deny-all by default: no policies = no access for anon/authenticated roles.
-- Edge functions use the service_role which bypasses RLS.
