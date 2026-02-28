
-- ============================================================================
-- PLANS TABLE
-- ============================================================================
CREATE TABLE public.plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_aud INTEGER NOT NULL DEFAULT 0,
  stripe_price_id TEXT,
  stripe_product_id TEXT,
  max_hunts INTEGER NOT NULL DEFAULT 1,
  push_alerts BOOLEAN NOT NULL DEFAULT false,
  email_alerts BOOLEAN NOT NULL DEFAULT false,
  sms_alerts BOOLEAN NOT NULL DEFAULT false,
  auction_data BOOLEAN NOT NULL DEFAULT false,
  priority_support BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Plans are viewable by everyone" ON public.plans FOR SELECT USING (true);

INSERT INTO public.plans (id, name, price_aud, stripe_price_id, stripe_product_id, max_hunts, push_alerts, email_alerts, sms_alerts, auction_data, priority_support) VALUES
  ('starter', 'Starter', 0, NULL, NULL, 1, false, false, false, false, false),
  ('pro', 'Pro', 24900, 'price_1T5uwCCExfJSi0xwVSlEqqGp', 'prod_U432SibxcRULB3', 10, true, true, false, true, false),
  ('premium', 'Premium', 49900, 'price_1T5vFACExfJSi0xwiDNQqmZA', 'prod_U43LxDJ8RJRhRX', -1, true, true, true, true, true);

-- ============================================================================
-- SUBSCRIPTIONS TABLE
-- ============================================================================
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dealer_profile_id UUID REFERENCES public.dealer_profiles(id) ON DELETE SET NULL,
  plan_id TEXT NOT NULL REFERENCES public.plans(id) DEFAULT 'starter',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own subscription" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own subscription" ON public.subscriptions FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================================
-- DEALER SETTINGS TABLE
-- ============================================================================
CREATE TABLE public.dealer_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  push_enabled BOOLEAN NOT NULL DEFAULT false,
  email_enabled BOOLEAN NOT NULL DEFAULT false,
  sms_enabled BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start INTEGER DEFAULT 19,
  quiet_hours_end INTEGER DEFAULT 7,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dealer_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own settings" ON public.dealer_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON public.dealer_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON public.dealer_settings FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- PUSH SUBSCRIPTIONS TABLE (replaces Google Sheets)
-- ============================================================================
CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  dealer_name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(dealer_name, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own push subs" ON public.push_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own push subs" ON public.push_subscriptions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role can read all push subs" ON public.push_subscriptions FOR SELECT USING (true);

-- ============================================================================
-- AUTO-PROVISION: New sign-up gets starter subscription + default settings
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan_id, status)
  VALUES (NEW.id, 'starter', 'active')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.dealer_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_subscription();

-- Update timestamp trigger
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_dealer_settings_updated_at
  BEFORE UPDATE ON public.dealer_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
