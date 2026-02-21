
-- CrossSafe: Job claim function (FOR UPDATE SKIP LOCKED)
CREATE OR REPLACE FUNCTION public.crosssafe_claim_job(p_worker_id TEXT)
RETURNS SETOF crosssafe_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job crosssafe_jobs;
BEGIN
  SELECT * INTO v_job
  FROM crosssafe_jobs
  WHERE status = 'queued'
    AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes')
  ORDER BY priority DESC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE crosssafe_jobs
  SET status = 'running',
      locked_at = now(),
      locked_by = p_worker_id,
      started_at = now(),
      attempts = attempts + 1
  WHERE id = v_job.id;

  v_job.status := 'running';
  v_job.locked_by := p_worker_id;
  v_job.started_at := now();
  v_job.attempts := v_job.attempts + 1;

  RETURN NEXT v_job;
END;
$$;
