
CREATE TABLE IF NOT EXISTS public.dealer_invites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  dealer_name TEXT,
  invited_by UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  consumed_at TIMESTAMPTZ,
  consumed_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dealer_invites_email_idx ON public.dealer_invites (lower(email)) WHERE status='pending';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealer_invites TO authenticated;
GRANT ALL ON public.dealer_invites TO service_role;

ALTER TABLE public.dealer_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage dealer invites"
ON public.dealer_invites
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Trigger: when a new auth user signs up, if an invite exists for their email,
-- create a dealer_profile linking them to the invited account.
CREATE OR REPLACE FUNCTION public.handle_new_dealer_invite()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
BEGIN
  SELECT * INTO inv
  FROM public.dealer_invites
  WHERE lower(email) = lower(NEW.email) AND status='pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF inv.id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.dealer_profiles (user_id, account_id, dealer_name, dealer_email)
  VALUES (NEW.id, inv.account_id, COALESCE(inv.dealer_name, NEW.email), NEW.email)
  ON CONFLICT DO NOTHING;

  UPDATE public.dealer_invites
  SET status='consumed', consumed_at=now(), consumed_user_id=NEW.id
  WHERE id = inv.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_dealer_invite ON auth.users;
CREATE TRIGGER on_auth_user_created_dealer_invite
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_dealer_invite();
