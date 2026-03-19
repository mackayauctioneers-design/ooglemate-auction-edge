CREATE TABLE public.login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text,
  logged_in_at timestamptz NOT NULL DEFAULT now(),
  ip_hint text,
  user_agent text
);

ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all login events"
  ON public.login_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can insert their own login events"
  ON public.login_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_login_events_user_id ON public.login_events(user_id);
CREATE INDEX idx_login_events_logged_in_at ON public.login_events(logged_in_at DESC);