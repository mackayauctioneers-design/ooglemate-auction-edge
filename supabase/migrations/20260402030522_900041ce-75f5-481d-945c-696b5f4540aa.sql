CREATE POLICY "Admins and internal users can create accounts"
ON public.accounts
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'internal')
);