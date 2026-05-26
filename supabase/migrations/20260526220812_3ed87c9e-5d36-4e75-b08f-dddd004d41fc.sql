WITH dupes AS (
  SELECT canonical.id AS canonical_id, orphan.id AS orphan_id
  FROM public.dealer_profiles canonical
  JOIN public.dealer_profiles orphan
    ON lower(orphan.dealer_name) = lower(canonical.dealer_name)
   AND orphan.id <> canonical.id
   AND orphan.account_id IS NULL
  WHERE canonical.account_id IS NOT NULL
)
UPDATE public.dealer_fingerprints df
SET dealer_profile_id = d.canonical_id
FROM dupes d
WHERE df.dealer_profile_id = d.orphan_id;

DELETE FROM public.dealer_profiles dp
USING (
  SELECT orphan.id AS orphan_id
  FROM public.dealer_profiles canonical
  JOIN public.dealer_profiles orphan
    ON lower(orphan.dealer_name) = lower(canonical.dealer_name)
   AND orphan.id <> canonical.id
   AND orphan.account_id IS NULL
  WHERE canonical.account_id IS NOT NULL
) d
WHERE dp.id = d.orphan_id;

CREATE UNIQUE INDEX IF NOT EXISTS dealer_profiles_account_name_uniq
  ON public.dealer_profiles (account_id, lower(dealer_name))
  WHERE account_id IS NOT NULL;