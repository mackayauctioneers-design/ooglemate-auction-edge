import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Atomically claim the next pending job using RPC
    // Uses SELECT ... FOR UPDATE SKIP LOCKED to prevent concurrent processing
    const { data: claimedJobs, error: claimError } = await supabase
      .rpc('claim_next_job');

    if (claimError) {
      const errMsg = typeof claimError === 'object' && claimError !== null && 'message' in claimError 
        ? (claimError as { message: string }).message 
        : JSON.stringify(claimError);
      throw new Error(`RPC claim_next_job failed: ${errMsg}`);
    }

    if (!claimedJobs || claimedJobs.length === 0) {
      console.log('[process-trap-jobs] No pending jobs');
      return new Response(
        JSON.stringify({ message: 'No pending jobs', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // RPC returns array, get first (and only) job
    const job = claimedJobs[0];
    const jobId = job.job_id;
    const trapSlug = job.trap_slug;
    const runType = job.run_type;
    const attempts = job.attempts; // Already incremented by RPC
    const maxAttempts = job.max_attempts;

    console.log(`[process-trap-jobs] Claimed job ${jobId}: ${trapSlug} (${runType}), attempt ${attempts}/${maxAttempts}`);

    // Get the trap details
    const { data: trap, error: trapError } = await supabase
      .from('dealer_traps')
      .select('*')
      .eq('trap_slug', trapSlug)
      .single();

    if (trapError || !trap) {
      await supabase
        .from('trap_crawl_jobs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error: `Trap not found: ${trapSlug}`,
        })
        .eq('id', jobId);

      return new Response(
        JSON.stringify({ error: 'Trap not found', job_id: jobId }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Invoke the dealer-site-crawl function with single trap
    const isValidation = runType === 'validation';
    const crawlUrl = `${supabaseUrl}/functions/v1/dealer-site-crawl`;
    
    try {
      const crawlResponse = await fetch(crawlUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dealer_slugs: [trapSlug],
          validate: isValidation,
          batch_limit: 1,
        }),
      });

      const crawlResult = await crawlResponse.json();
      
      if (!crawlResponse.ok) {
        throw new Error(crawlResult.error || `Crawl failed with status ${crawlResponse.status}`);
      }

      // Update job as completed
      await supabase
        .from('trap_crawl_jobs')
        .update({
          status: 'completed',
          finished_at: new Date().toISOString(),
          result: crawlResult,
        })
        .eq('id', jobId);

      const elapsed = Date.now() - startTime;
      console.log(`[process-trap-jobs] Job ${jobId} completed in ${elapsed}ms`);

      return new Response(
        JSON.stringify({
          message: 'Job processed successfully',
          job_id: jobId,
          trap_slug: trapSlug,
          run_type: runType,
          attempts,
          result: crawlResult,
          elapsed_ms: elapsed,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (crawlError: unknown) {
      const crawlMessage = crawlError instanceof Error ? crawlError.message : String(crawlError);
      console.error(`[process-trap-jobs] Crawl error for ${trapSlug}:`, crawlMessage);
      
      // attempts is already incremented by the RPC claim
      const isFinalFailure = attempts >= maxAttempts;

      // Build update payload conditionally to avoid undefined
      // - Retry: status='pending', started_at=null, finished_at=null, keep error
      // - Final failure: status='failed', finished_at=now(), preserve started_at (omit from payload)
      const updatePayload: Record<string, unknown> = {
        status: isFinalFailure ? 'failed' : 'pending',
        finished_at: isFinalFailure ? new Date().toISOString() : null,
        error: crawlMessage,
      };
      
      // Only set started_at to null on retry (omit for final failure to preserve)
      if (!isFinalFailure) {
        updatePayload.started_at = null;
      }

      await supabase
        .from('trap_crawl_jobs')
        .update(updatePayload)
        .eq('id', jobId);

      return new Response(
        JSON.stringify({
          message: isFinalFailure ? 'Job failed permanently' : 'Job will retry',
          job_id: jobId,
          attempts,
          max_attempts: maxAttempts,
          error: crawlMessage,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[process-trap-jobs] Error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
