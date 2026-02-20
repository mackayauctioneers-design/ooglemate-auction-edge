-- Allow authenticated users to read their own matched opportunities
CREATE POLICY "Users can view matched opportunities for their accounts"
  ON public.matched_opportunities_v1
  FOR SELECT
  USING (
    account_id IN (
      SELECT dp.account_id FROM public.dealer_profiles dp
      WHERE dp.user_id = auth.uid()
      AND dp.account_id IS NOT NULL
    )
  );

-- Allow authenticated users to update status on their own opportunities
CREATE POLICY "Users can update matched opportunities for their accounts"
  ON public.matched_opportunities_v1
  FOR UPDATE
  USING (
    account_id IN (
      SELECT dp.account_id FROM public.dealer_profiles dp
      WHERE dp.user_id = auth.uid()
      AND dp.account_id IS NOT NULL
    )
  );