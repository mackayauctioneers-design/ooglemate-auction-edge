
-- Allow dealers to read and update their own opportunities on the Trading Desk
CREATE POLICY "Dealers read own opportunities"
ON public.operator_opportunities
FOR SELECT TO authenticated
USING (
  best_account_id IN (
    SELECT account_id FROM public.dealer_profiles
    WHERE user_id = auth.uid() AND account_id IS NOT NULL
  )
);

CREATE POLICY "Dealers update own opportunities"
ON public.operator_opportunities
FOR UPDATE TO authenticated
USING (
  best_account_id IN (
    SELECT account_id FROM public.dealer_profiles
    WHERE user_id = auth.uid() AND account_id IS NOT NULL
  )
)
WITH CHECK (
  best_account_id IN (
    SELECT account_id FROM public.dealer_profiles
    WHERE user_id = auth.uid() AND account_id IS NOT NULL
  )
);
