-- Store session cookies for HTTP APIs that require auth
CREATE TABLE IF NOT EXISTS public.http_session_secrets (
  site text PRIMARY KEY,
  cookie_header text NOT NULL,
  user_agent text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  last_status int NULL,
  last_error text NULL
);

ALTER TABLE public.http_session_secrets ENABLE ROW LEVEL SECURITY;

-- Service-role-only access
DROP POLICY IF EXISTS "service_role_full_access_http_session_secrets" ON public.http_session_secrets;
CREATE POLICY "service_role_full_access_http_session_secrets"
ON public.http_session_secrets
FOR ALL
USING (true)
WITH CHECK (true);