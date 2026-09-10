-- 1. Agent registry
CREATE TABLE public.agent_registry (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'worker',
  description TEXT,
  owner TEXT,
  auth_scheme TEXT NOT NULL DEFAULT 'shared_secret',
  endpoint TEXT,
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  expected_interval_minutes INTEGER NOT NULL DEFAULT 60,
  last_seen_at TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_registry TO authenticated;
GRANT ALL ON public.agent_registry TO service_role;
ALTER TABLE public.agent_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage agent registry"
ON public.agent_registry FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can read agent registry"
ON public.agent_registry FOR SELECT TO authenticated
USING (true);

-- 2. Agent watch links (agent <-> dealership / source)
CREATE TABLE public.agent_watch_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.agent_registry(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  dealer_slug TEXT,
  watch_type TEXT NOT NULL DEFAULT 'dealer',
  target_ref TEXT NOT NULL DEFAULT '',
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  items_last_run INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, watch_type, target_ref, account_id)
);

CREATE INDEX idx_agent_watch_links_account ON public.agent_watch_links(account_id);
CREATE INDEX idx_agent_watch_links_agent ON public.agent_watch_links(agent_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_watch_links TO authenticated;
GRANT ALL ON public.agent_watch_links TO service_role;
ALTER TABLE public.agent_watch_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage agent watch links"
ON public.agent_watch_links FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Dealers read their own agent watch links"
ON public.agent_watch_links FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.dealer_profiles dp
    WHERE dp.user_id = auth.uid()
      AND dp.account_id = agent_watch_links.account_id
  )
);

-- 3. Heartbeats
CREATE TABLE public.agent_heartbeats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES public.agent_registry(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ok',
  message TEXT,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_heartbeats_agent_time ON public.agent_heartbeats(agent_id, created_at DESC);

GRANT SELECT ON public.agent_heartbeats TO authenticated;
GRANT ALL ON public.agent_heartbeats TO service_role;
ALTER TABLE public.agent_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read agent heartbeats"
ON public.agent_heartbeats FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Dealers read heartbeats of agents watching them"
ON public.agent_heartbeats FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.agent_watch_links l
    JOIN public.dealer_profiles dp ON dp.account_id = l.account_id
    WHERE l.agent_id = agent_heartbeats.agent_id
      AND dp.user_id = auth.uid()
  )
);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_agent_registry_updated_at
BEFORE UPDATE ON public.agent_registry
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_agent_watch_links_updated_at
BEFORE UPDATE ON public.agent_watch_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();