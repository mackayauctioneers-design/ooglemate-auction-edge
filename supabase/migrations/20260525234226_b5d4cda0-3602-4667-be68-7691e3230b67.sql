ALTER TABLE public.dealer_outbound_sources
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dos_account_id
  ON public.dealer_outbound_sources (account_id);

UPDATE public.dealer_outbound_sources d
   SET account_id = a.id
  FROM public.accounts a
 WHERE d.account_id IS NULL
   AND lower(d.dealer_slug) = lower(a.slug);

INSERT INTO public.dealer_outbound_sources (dealer_slug, dealer_name, dealer_domain, account_id, enabled)
VALUES ('patrick-auto', 'Patrick Auto Group', 'patrickautogroup.com.au', 'd8ed6d5c-3284-4b76-a17e-f1f000afe827', true)
ON CONFLICT (dealer_slug) DO UPDATE
  SET account_id = EXCLUDED.account_id,
      dealer_name = COALESCE(public.dealer_outbound_sources.dealer_name, EXCLUDED.dealer_name);