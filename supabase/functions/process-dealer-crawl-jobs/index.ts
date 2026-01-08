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
      console.log('[process-dealer-crawl-jobs] No pending jobs');
      return new Response(
        JSON.stringify({ message: 'No pending jobs', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // RPC returns array, get first (and only) job
    const job = claimedJobs[0];
    const jobId = job.job_id;
    const dealerSlug = job.dealer_slug;
    const runType = job.run_type;
    const attempts = job.attempts; // Already incremented by RPC
    const maxAttempts = job.max_attempts;

    console.log(`[process-dealer-crawl-jobs] Claimed job ${jobId}: ${dealerSlug} (${runType}), attempt ${attempts}/${maxAttempts}`);

    // Get the rooftop details
    const { data: rooftop, error: rooftopError } = await supabase
      .from('dealer_rooftops')
      .select('*')
      .eq('dealer_slug', dealerSlug)
      .single();

    if (rooftopError || !rooftop) {
      await supabase
        .from('dealer_crawl_jobs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error: `Rooftop not found: ${dealerSlug}`,
        })
        .eq('id', jobId);

      return new Response(
        JSON.stringify({ error: 'Rooftop not found', job_id: jobId }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Invoke the dealer-site-crawl function with single dealer
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
          dealer_slugs: [dealerSlug],
          validation_mode: isValidation,
          max_dealers: 1,
        }),
      });

      const crawlResult = await crawlResponse.json();
      
      if (!crawlResponse.ok) {
        throw new Error(crawlResult.error || `Crawl failed with status ${crawlResponse.status}`);
      }

      // Update job as completed
      await supabase
        .from('dealer_crawl_jobs')
        .update({
          status: 'completed',
          finished_at: new Date().toISOString(),
          result: crawlResult,
        })
        .eq('id', jobId);

      const elapsed = Date.now() - startTime;
      console.log(`[process-dealer-crawl-jobs] Job ${jobId} completed in ${elapsed}ms`);

      return new Response(
        JSON.stringify({
          message: 'Job processed successfully',
          job_id: jobId,
          dealer_slug: dealerSlug,
          run_type: runType,
          attempts,
          result: crawlResult,
          elapsed_ms: elapsed,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (crawlError: unknown) {
      const crawlMessage = crawlError instanceof Error ? crawlError.message : String(crawlError);
      console.error(`[process-dealer-crawl-jobs] Crawl error for ${dealerSlug}:`, crawlMessage);
      
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
        .from('dealer_crawl_jobs')
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
    console.error('[process-dealer-crawl-jobs] Error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
