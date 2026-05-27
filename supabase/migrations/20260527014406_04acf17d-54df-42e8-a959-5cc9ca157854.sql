
CREATE TABLE public.dealer_intelligence_profiles (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  master_brief_md text DEFAULT '',
  auto_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  weights jsonb NOT NULL DEFAULT '{"MAKE":{},"MAKE_MODEL":{}}'::jsonb,
  weights_source text NOT NULL DEFAULT 'blended' CHECK (weights_source IN ('manual','auto','blended')),
  last_rebuilt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealer_intelligence_profiles TO authenticated;
GRANT ALL ON public.dealer_intelligence_profiles TO service_role;

ALTER TABLE public.dealer_intelligence_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all dealer intel"
  ON public.dealer_intelligence_profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Dealers read own intel"
  ON public.dealer_intelligence_profiles
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.dealer_profiles dp
    JOIN public.dealer_profile_user_links l ON l.dealer_profile_id = dp.id
    WHERE dp.account_id = dealer_intelligence_profiles.account_id
      AND l.user_id = auth.uid()
  ));

CREATE TRIGGER trg_dealer_intel_updated_at
BEFORE UPDATE ON public.dealer_intelligence_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.operator_opportunities
  ADD COLUMN IF NOT EXISTS applied_weight numeric DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS weighted_margin numeric;
