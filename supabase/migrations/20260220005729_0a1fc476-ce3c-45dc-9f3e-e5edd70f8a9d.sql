-- Drop the narrow policies and replace with ones that check dealer_profile_user_links
DROP POLICY IF EXISTS "Users can view matched opportunities for their accounts" ON public.matched_opportunities_v1;
DROP POLICY IF EXISTS "Users can update matched opportunities for their accounts" ON public.matched_opportunities_v1;

-- SELECT: user can see opportunities for accounts linked via dealer_profile_user_links
CREATE POLICY "Users can view matched opportunities for their accounts"
  ON public.matched_opportunities_v1
  FOR SELECT
  USING (
    account_id IN (
      SELECT dp.account_id FROM public.dealer_profiles dp
      JOIN public.dealer_profile_user_links dpul ON dpul.dealer_profile_id = dp.id
      WHERE dpul.user_id = auth.uid()
      AND dp.account_id IS NOT NULL
    )
  );

-- UPDATE: same scoping
CREATE POLICY "Users can update matched opportunities for their accounts"
  ON public.matched_opportunities_v1
  FOR UPDATE
  USING (
    account_id IN (
      SELECT dp.account_id FROM public.dealer_profiles dp
      JOIN public.dealer_profile_user_links dpul ON dpul.dealer_profile_id = dp.id
      WHERE dpul.user_id = auth.uid()
      AND dp.account_id IS NOT NULL
    )
  );