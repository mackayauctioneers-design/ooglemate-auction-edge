CREATE OR REPLACE FUNCTION public.claim_next_star_watch_jobs(_limit integer DEFAULT 5, _locked_by text DEFAULT 'star-watch-runner'::text)
 RETURNS SETOF star_watch_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Auto-fail jobs that have exceeded retry budget
  update public.star_watch_jobs
     set status = 'failed',
         finished_at = now(),
         last_error = coalesce(last_error, '') || ' [max_attempts_exceeded]'
   where status in ('queued', 'running')
     and attempt_count >= 5;

  return query
  with picked as (
    select id
      from public.star_watch_jobs
     where (status = 'queued'
        or (status = 'running' and locked_at < now() - interval '5 minutes'))
       and attempt_count < 5
     order by created_at
     for update skip locked
     limit _limit
  )
  update public.star_watch_jobs j
     set status = 'running',
         locked_at = now(),
         locked_by = _locked_by,
         attempt_count = j.attempt_count + 1,
         started_at = coalesce(j.started_at, now())
    from picked
   where j.id = picked.id
   returning j.*;
end;
$function$;