-- Improve trigger guard: avoid re-checks if identity unchanged
CREATE OR REPLACE FUNCTION public.trigger_check_identity_sold_returned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only run when identity_id is newly assigned OR changed to different value
  IF NEW.identity_id IS NOT NULL 
     AND OLD.identity_id IS DISTINCT FROM NEW.identity_id THEN
    PERFORM public.check_identity_linked_sold_returned(
      NEW.id,
      NEW.identity_id,
      NEW.source,
      14  -- window days
    );
  END IF;
  RETURN NEW;
END;
$$;