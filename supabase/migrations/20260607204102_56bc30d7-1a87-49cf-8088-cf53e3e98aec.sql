
-- 1. Auto-approve tier 1 high-confidence items on insert
CREATE OR REPLACE FUNCTION public.wholesale_queue_auto_approve()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending'
     AND NEW.tier = 1
     AND COALESCE(NEW.confidence_score, 0) >= 80 THEN
    NEW.status := 'approved';
    NEW.reviewed_at := now();
    NEW.decision_reason := COALESCE(NEW.decision_reason, 'auto-approved: tier 1, confidence >= 80');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wholesale_queue_auto_approve ON public.wholesale_manager_queue;
CREATE TRIGGER trg_wholesale_queue_auto_approve
BEFORE INSERT ON public.wholesale_manager_queue
FOR EACH ROW EXECUTE FUNCTION public.wholesale_queue_auto_approve();

-- 2. Stale sweep function: expire pending items older than 7 days
CREATE OR REPLACE FUNCTION public.wholesale_queue_expire_stale()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.wholesale_manager_queue
  SET status = 'expired',
      reviewed_at = now(),
      decision_reason = COALESCE(decision_reason, 'auto-expired: pending > 7 days')
  WHERE status = 'pending'
    AND created_at < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
