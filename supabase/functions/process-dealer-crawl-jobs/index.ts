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

    // Claim the oldest pending job (atomic update)
    const { data: jobs, error: claimError } = await supabase
      .from('dealer_crawl_jobs')
      .update({ 
        status: 'processing', 
        started_at: new Date().toISOString()
      })
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .select('*');

    if (claimError) {
      throw claimError;
    }

    if (!jobs || jobs.length === 0) {
      console.log('[process-dealer-crawl-jobs] No pending jobs');
      return new Response(
        JSON.stringify({ message: 'No pending jobs', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const job = jobs[0];
    console.log(`[process-dealer-crawl-jobs] Processing job ${job.id}: ${job.dealer_slug} (${job.run_type})`);

    // Increment attempts
    await supabase
      .from('dealer_crawl_jobs')
      .update({ attempts: job.attempts + 1 })
      .eq('id', job.id);

    // Get the rooftop details
    const { data: rooftop, error: rooftopError } = await supabase
      .from('dealer_rooftops')
      .select('*')
      .eq('dealer_slug', job.dealer_slug)
      .single();

    if (rooftopError || !rooftop) {
      await supabase
        .from('dealer_crawl_jobs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error: `Rooftop not found: ${job.dealer_slug}`,
        })
        .eq('id', job.id);

      return new Response(
        JSON.stringify({ error: 'Rooftop not found', job_id: job.id }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Invoke the dealer-site-crawl function with single dealer
    const isValidation = job.run_type === 'validation';
    const crawlUrl = `${supabaseUrl}/functions/v1/dealer-site-crawl`;
    
    try {
      const crawlResponse = await fetch(crawlUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dealer_slugs: [job.dealer_slug],
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
        .eq('id', job.id);

      const elapsed = Date.now() - startTime;
      console.log(`[process-dealer-crawl-jobs] Job ${job.id} completed in ${elapsed}ms`);

      return new Response(
        JSON.stringify({
          message: 'Job processed successfully',
          job_id: job.id,
          dealer_slug: job.dealer_slug,
          run_type: job.run_type,
          result: crawlResult,
          elapsed_ms: elapsed,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (crawlError: unknown) {
      const crawlMessage = crawlError instanceof Error ? crawlError.message : String(crawlError);
      console.error(`[process-dealer-crawl-jobs] Crawl error for ${job.dealer_slug}:`, crawlMessage);
      
      const newAttempts = job.attempts + 1;
      const isFinalFailure = newAttempts >= job.max_attempts;

      await supabase
        .from('dealer_crawl_jobs')
        .update({
          status: isFinalFailure ? 'failed' : 'pending',
          finished_at: isFinalFailure ? new Date().toISOString() : null,
          started_at: isFinalFailure ? job.started_at : null,
          error: crawlMessage,
        })
        .eq('id', job.id);

      return new Response(
        JSON.stringify({
          message: isFinalFailure ? 'Job failed permanently' : 'Job will retry',
          job_id: job.id,
          attempts: newAttempts,
          max_attempts: job.max_attempts,
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
