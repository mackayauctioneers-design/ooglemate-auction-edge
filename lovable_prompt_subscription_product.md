# Lovable Prompt: CarBitrage Pro — Dealer Subscription Product

Paste the block below directly into Lovable as a single prompt.

---

## PROMPT

Build the complete CarBitrage Pro dealer subscription product. This is a multi-part build covering database infrastructure, Stripe integration, self-serve onboarding, and a cleaned-up dealer UI. Follow every instruction precisely.

---

### PART 1 — DATABASE MIGRATIONS

Create the following migration file: `supabase/migrations/20260301000000_subscription_product.sql`

```sql
-- ============================================================================
-- CARBITRAGE PRO: SUBSCRIPTION PRODUCT INFRASTRUCTURE
-- ============================================================================

-- 1. PLANS TABLE
-- Defines the available subscription tiers.
CREATE TABLE IF NOT EXISTS public.plans (
  id text PRIMARY KEY,  -- e.g. 'free', 'pro', 'premium'
  display_name text NOT NULL,
  price_monthly_aud numeric NOT NULL DEFAULT 0,
  stripe_price_id text,  -- Stripe Price ID for this plan
  max_hunts integer NOT NULL DEFAULT 5,
  alert_speed text NOT NULL DEFAULT 'standard' CHECK (alert_speed IN ('standard', 'fast', 'realtime')),
  features jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plans (id, display_name, price_monthly_aud, max_hunts, alert_speed, features, sort_order) VALUES
  ('free',    'Starter',  0,   3,  'standard', '["Up to 3 active hunts", "Daily alert digest", "Basic match data"]', 0),
  ('pro',     'Pro',      249, 25, 'fast',     '["Up to 25 active hunts", "Real-time push alerts", "Full match data with benchmark", "Email & SMS alerts", "Sales history analytics"]', 1),
  ('premium', 'Premium',  499, 999,'realtime', '["Unlimited active hunts", "Instant alerts", "Full match data", "Email, SMS & push alerts", "Advanced analytics", "Priority support"]', 2)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read plans" ON public.plans FOR SELECT USING (true);

-- 2. SUBSCRIPTIONS TABLE
-- Links a dealer to their current plan and Stripe subscription.
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES public.plans(id) DEFAULT 'free',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled', 'incomplete')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dealer_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_dealer ON public.subscriptions(dealer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON public.subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON public.subscriptions(stripe_subscription_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dealers can read own subscription" ON public.subscriptions FOR SELECT TO authenticated USING (dealer_id = auth.uid());
CREATE POLICY "Service role can manage subscriptions" ON public.subscriptions FOR ALL TO service_role USING (true);
CREATE POLICY "Admins can read all subscriptions" ON public.subscriptions FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- 3. DEALER_SETTINGS TABLE
-- Stores notification preferences and UI settings per dealer.
CREATE TABLE IF NOT EXISTS public.dealer_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notify_buy_push boolean NOT NULL DEFAULT true,
  notify_watch_push boolean NOT NULL DEFAULT false,
  notify_buy_email boolean NOT NULL DEFAULT true,
  notify_watch_email boolean NOT NULL DEFAULT false,
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_hours_start integer DEFAULT 22 CHECK (quiet_hours_start >= 0 AND quiet_hours_start <= 23),
  quiet_hours_end integer DEFAULT 7 CHECK (quiet_hours_end >= 0 AND quiet_hours_end <= 23),
  phone_number text,
  notify_buy_sms boolean NOT NULL DEFAULT false,
  onboarding_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dealer_id)
);

ALTER TABLE public.dealer_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dealers can manage own settings" ON public.dealer_settings FOR ALL TO authenticated USING (dealer_id = auth.uid());
CREATE POLICY "Service role can manage dealer_settings" ON public.dealer_settings FOR ALL TO service_role USING (true);

-- 4. PUSH_SUBSCRIPTIONS TABLE
-- Replaces the Google Sheets push notification backend.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth_key text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (dealer_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_dealer ON public.push_subscriptions(dealer_id) WHERE is_active = true;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dealers can manage own push subscriptions" ON public.push_subscriptions FOR ALL TO authenticated USING (dealer_id = auth.uid());
CREATE POLICY "Service role can manage push_subscriptions" ON public.push_subscriptions FOR ALL TO service_role USING (true);

-- 5. AUTO-CREATE FREE SUBSCRIPTION ON SIGN-UP
-- Trigger: when a new user signs up, create a free subscription and default settings.
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.subscriptions (dealer_id, plan_id, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (dealer_id) DO NOTHING;

  INSERT INTO public.dealer_settings (dealer_id)
  VALUES (NEW.id)
  ON CONFLICT (dealer_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_subscription ON auth.users;
CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_subscription();
```

---

### PART 2 — STRIPE EDGE FUNCTIONS

#### 2a. Create `supabase/functions/create-checkout-session/index.ts`

This function creates a Stripe Checkout session for a dealer upgrading to a paid plan.

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

  const { data: { user }, error: authError } = await sb.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

  const { plan_id, success_url, cancel_url } = await req.json();

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!STRIPE_SECRET_KEY) return new Response(JSON.stringify({ error: "Stripe not configured" }), { status: 500, headers: corsHeaders });

  // Get plan details
  const { data: plan } = await sb.from("plans").select("*").eq("id", plan_id).single();
  if (!plan?.stripe_price_id) {
    return new Response(JSON.stringify({ error: "Invalid plan or Stripe price not configured" }), { status: 400, headers: corsHeaders });
  }

  // Get or create Stripe customer
  const { data: sub } = await sb.from("subscriptions").select("stripe_customer_id").eq("dealer_id", user.id).single();
  
  let customerId = sub?.stripe_customer_id;
  if (!customerId) {
    const customerRes = await fetch("https://api.stripe.com/v1/customers", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ email: user.email!, "metadata[dealer_id]": user.id }),
    });
    const customer = await customerRes.json();
    customerId = customer.id;
    await sb.from("subscriptions").update({ stripe_customer_id: customerId }).eq("dealer_id", user.id);
  }

  // Create Checkout Session
  const sessionRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      customer: customerId,
      mode: "subscription",
      "line_items[0][price]": plan.stripe_price_id,
      "line_items[0][quantity]": "1",
      success_url: success_url || `${Deno.env.get("SITE_URL")}/onboarding/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${Deno.env.get("SITE_URL")}/pricing`,
      "metadata[dealer_id]": user.id,
      "metadata[plan_id]": plan_id,
      "subscription_data[metadata][dealer_id]": user.id,
      "subscription_data[metadata][plan_id]": plan_id,
    }),
  });

  const session = await sessionRes.json();
  if (session.error) return new Response(JSON.stringify({ error: session.error.message }), { status: 400, headers: corsHeaders });

  return new Response(JSON.stringify({ url: session.url, session_id: session.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
```

#### 2b. Create `supabase/functions/stripe-webhook/index.ts`

This function handles Stripe webhook events to keep the `subscriptions` table in sync.

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  // Note: Full Stripe signature verification requires the stripe npm package.
  // For now, parse the event directly. Add signature verification in production.
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  console.log(`[STRIPE-WEBHOOK] Event: ${event.type}`);

  const obj = event.data?.object;

  if (event.type === "checkout.session.completed") {
    const dealerId = obj.metadata?.dealer_id;
    const planId = obj.metadata?.plan_id;
    const stripeSubId = obj.subscription;
    const stripeCustomerId = obj.customer;

    if (dealerId && planId) {
      await sb.from("subscriptions").upsert({
        dealer_id: dealerId,
        plan_id: planId,
        status: "active",
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "dealer_id" });

      // Mark onboarding as needing completion
      await sb.from("dealer_settings").upsert({
        dealer_id: dealerId,
        onboarding_completed: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: "dealer_id" });

      console.log(`[STRIPE-WEBHOOK] Subscription activated for dealer ${dealerId} on plan ${planId}`);
    }
  }

  if (event.type === "customer.subscription.updated") {
    const dealerId = obj.metadata?.dealer_id;
    const planId = obj.metadata?.plan_id;
    if (dealerId) {
      await sb.from("subscriptions").update({
        status: obj.status,
        plan_id: planId || undefined,
        current_period_start: new Date(obj.current_period_start * 1000).toISOString(),
        current_period_end: new Date(obj.current_period_end * 1000).toISOString(),
        cancel_at_period_end: obj.cancel_at_period_end,
        updated_at: new Date().toISOString(),
      }).eq("dealer_id", dealerId);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const dealerId = obj.metadata?.dealer_id;
    if (dealerId) {
      await sb.from("subscriptions").update({
        status: "cancelled",
        plan_id: "free",
        stripe_subscription_id: null,
        updated_at: new Date().toISOString(),
      }).eq("dealer_id", dealerId);
    }
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
```

---

### PART 3 — REFACTOR PUSH NOTIFICATION FUNCTIONS

#### 3a. Replace `supabase/functions/push-subscribe/index.ts` entirely

Remove all Google Sheets code. Write the subscriptions to the `push_subscriptions` table instead.

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

  const { data: { user } } = await sb.auth.getUser(authHeader.replace("Bearer ", ""));
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

  const { endpoint, p256dh, auth, userAgent } = await req.json();

  if (!endpoint || !p256dh || !auth) {
    return new Response(JSON.stringify({ error: "Missing subscription fields" }), { status: 400, headers: corsHeaders });
  }

  const { error } = await sb.from("push_subscriptions").upsert({
    dealer_id: user.id,
    endpoint,
    p256dh,
    auth_key: auth,
    user_agent: userAgent || null,
    is_active: true,
    last_used_at: new Date().toISOString(),
  }, { onConflict: "dealer_id,endpoint" });

  if (error) {
    console.error("[PUSH-SUBSCRIBE] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
```

#### 3b. Replace `supabase/functions/push-send/index.ts` entirely

Remove all Google Sheets code. Read subscriptions from the `push_subscriptions` table instead.

Keep the existing VAPID JWT logic and `sendPush` function intact. Only replace the part that fetches subscriptions — change it from reading a Google Sheet to querying `push_subscriptions` from Supabase. The function signature for `serve` should accept a `dealer_id` parameter and look up that dealer's active push subscriptions from the database.

---

### PART 4 — REACT PAGES & COMPONENTS

#### 4a. Create `src/pages/PricingPage.tsx`

A public-facing pricing page at route `/pricing`. No auth required.

The page should display three plan cards side by side (Starter, Pro, Premium) using the data from the `plans` table fetched via Supabase. Each card shows:
- Plan name and price per month (AUD)
- Feature list (from the `features` jsonb column)
- A CTA button: "Get Started Free" for Starter (links to `/auth?mode=signup`), "Subscribe — $249/mo" for Pro, "Subscribe — $499/mo" for Premium
- The Pro card should be visually highlighted as "Most Popular"

For authenticated users who are already on a paid plan, show their current plan with a "Manage Billing" button instead.

Use the existing dark theme (black background, white/muted text, `border-white/10` borders) consistent with `AuthPage.tsx`.

Add the route `<Route path="/pricing" element={<PricingPage />} />` in `App.tsx` (no auth guard — it's public).

#### 4b. Enhance `src/pages/AuthPage.tsx`

Add a "Sign Up" mode to the existing auth page. The page should support two modes: `login` (default) and `signup`.

When in signup mode, show:
- Full name field
- Email field
- Password field (min 8 chars)
- Confirm password field
- "Create Account" button
- On success, call `supabase.auth.signUp()` then redirect to `/onboarding`

Add a toggle link at the bottom of the login card: "Don't have an account? Sign up free" that switches to signup mode.

Also accept a URL query param `?mode=signup` that auto-switches to signup mode on load.

#### 4c. Create `src/pages/OnboardingPage.tsx`

A multi-step onboarding flow at route `/onboarding`. Requires auth (`RequireAuth` guard).

**Step 1 — Welcome & Profile**
- Heading: "Welcome to CarBitrage Pro"
- Subheading: "Let's set up your account in 3 quick steps"
- Fields: Dealership name (saves to `dealer_profiles.dealer_name`), State (dropdown: NSW, VIC, QLD, SA, WA, TAS, NT, ACT), Phone number (optional, saves to `dealer_settings.phone_number`)
- Button: "Continue"

**Step 2 — Choose Your Plan**
- Heading: "Choose a plan"
- Show the three plan cards (same as PricingPage but inline)
- Starter: "Start Free" button → skips to Step 3
- Pro/Premium: "Subscribe" button → calls `create-checkout-session` edge function → redirects to Stripe Checkout. On return from Stripe (success_url = `/onboarding/welcome`), skip to Step 3.

**Step 3 — Set Up Your First Hunt**
- Heading: "Set up your first hunt"
- Subheading: "Tell us what you buy and we'll alert you when one appears"
- Inline mini-form: Make, Model, Year Min/Max, Max KM, Max Price
- "Create Hunt" button → inserts into `dealer_specs` table with `dealer_id = user.id`
- "Skip for now" link
- On complete, redirect to `/dealer-home`

Add routes in `App.tsx`:
```
<Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
<Route path="/onboarding/welcome" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
```

After signup, redirect to `/onboarding` instead of `/today`.

#### 4d. Create `src/pages/DealerHomePage.tsx`

The new dealer home page at route `/dealer-home`. Requires auth. This replaces `/trading-desk` as the dealer landing page.

Show:
- A greeting: "Good morning, [dealer_name]" (or afternoon/evening based on AEST time)
- A subscription status banner: current plan name + "Upgrade" link if on free plan
- A "My Hunts" summary card: number of active hunts, number of unread alerts today
- A "Recent Alerts" card: last 5 `hunt_alerts` for this dealer with `alert_type = 'BUY'`, showing make/model/year/km/asking_price/source and a link to the listing
- An "OogleBot" quick-search card with a search input

#### 4e. Create `src/pages/dealer/MyHuntsPage.tsx`

A hunt management page at route `/my-hunts`. Requires auth.

Show a list of all `dealer_specs` for the current dealer (where `deleted_at IS NULL`). For each hunt show:
- Hunt name, make, model, year range, km range, max price
- Status badge (Active / Paused)
- Alert count (count of `hunt_alerts` for this spec in the last 30 days)
- Edit button (links to existing `/dealer/specs/:id`)
- Toggle enabled/disabled switch
- Delete button (soft delete: sets `deleted_at`)

Add a "New Hunt" button at the top that links to `/dealer/specs/new`.

Add the route in `App.tsx`: `<Route path="/my-hunts" element={<RequireAuth><MyHuntsPage /></RequireAuth>} />`

#### 4f. Create `src/pages/dealer/DealerSettingsPage.tsx`

A settings page at route `/settings`. Requires auth.

Sections:
1. **Profile** — Dealership name (editable), email (read-only), phone number, state
2. **Notifications** — Toggle switches for: Buy alerts via push, Buy alerts via email, Watch alerts via push, Quiet hours (with start/end time selectors)
3. **Subscription** — Current plan name, renewal date, "Upgrade Plan" button (links to `/pricing`), "Manage Billing" button (calls a `create-billing-portal-session` edge function — can be a placeholder for now)
4. **Account** — "Sign Out" button

All changes save to `dealer_settings` and `dealer_profiles` tables on submit.

Add the route in `App.tsx`: `<Route path="/settings" element={<RequireAuth><DealerSettingsPage /></RequireAuth>} />`

---

### PART 5 — UPDATE DEALER SIDEBAR (`src/components/layout/AppSidebar.tsx`)

Replace the `dealerNavItems` array with:

```typescript
const dealerNavItems = [
  { path: '/dealer-home', label: 'Home', icon: Home, authOnly: true },
  { path: '/ooglebot', label: 'OogleBot', icon: Bot, authOnly: true },
  { path: '/my-hunts', label: 'My Hunts', icon: Target, authOnly: true },
  { path: '/sales-upload', label: 'My Sales', icon: BarChart3, authOnly: true },
  { path: '/settings', label: 'Settings', icon: Settings, authOnly: true },
];
```

Import `Home`, `Target`, and `Settings` from `lucide-react` (they are already available).

Also update the post-login redirect in `AuthContext.tsx`: after a successful login, if the user's role is `dealer`, redirect to `/dealer-home` instead of `/today`.

---

### PART 6 — UPDATE AUTH CONTEXT REDIRECT

In `src/contexts/AuthContext.tsx`, after fetching the user role on sign-in, redirect dealers to `/dealer-home` and admins/internal to `/today`. This logic should live in the `AuthPage.tsx` sign-in handler — after `supabase.auth.signInWithPassword` succeeds, fetch the role and navigate accordingly.

---

### SUMMARY OF ALL NEW FILES

- `supabase/migrations/20260301000000_subscription_product.sql`
- `supabase/functions/create-checkout-session/index.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/push-subscribe/index.ts` (full replacement)
- `supabase/functions/push-send/index.ts` (partial replacement — remove Google Sheets, read from DB)
- `src/pages/PricingPage.tsx`
- `src/pages/OnboardingPage.tsx`
- `src/pages/DealerHomePage.tsx`
- `src/pages/dealer/MyHuntsPage.tsx`
- `src/pages/dealer/DealerSettingsPage.tsx`

### SUMMARY OF MODIFIED FILES

- `src/pages/AuthPage.tsx` — add signup mode + `?mode=signup` param
- `src/App.tsx` — add all new routes
- `src/components/layout/AppSidebar.tsx` — update `dealerNavItems`
