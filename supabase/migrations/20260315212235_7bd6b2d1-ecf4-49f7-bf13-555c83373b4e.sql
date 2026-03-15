CREATE TABLE IF NOT EXISTS public.bob_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_profile_id text NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  page_context jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bob_conversations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.bob_watch_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_profile_id text NOT NULL,
  search_profile jsonb NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_match_at timestamptz,
  matches_found integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bob_watch_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own conversations" ON public.bob_conversations
  FOR ALL TO authenticated
  USING (dealer_profile_id = auth.uid()::text);

CREATE POLICY "Users see own watches" ON public.bob_watch_profiles
  FOR ALL TO authenticated
  USING (dealer_profile_id = auth.uid()::text);