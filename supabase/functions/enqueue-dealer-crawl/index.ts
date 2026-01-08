import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { dealer_slugs, run_type = 'validation' } = await req.json();

    if (!dealer_slugs || !Array.isArray(dealer_slugs) || dealer_slugs.length === 0) {
      return new Response(
        JSON.stringify({ error: 'dealer_slugs array required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!['validation', 'cron'].includes(run_type)) {
      return new Response(
        JSON.stringify({ error: 'run_type must be "validation" or "cron"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert jobs (dedup constraint will reject duplicates for pending/processing)
    const jobs = dealer_slugs.map((slug: string) => ({
      dealer_slug: slug,
      run_type,
    }));

    const { data, error } = await supabase
      .from('dealer_crawl_jobs')
      .insert(jobs)
      .select('id, dealer_slug, run_type, status');

    if (error) {
      // Check if it's a unique constraint violation (duplicate job)
      if (error.code === '23505') {
        return new Response(
          JSON.stringify({ 
            message: 'Jobs already queued or processing',
            queued: 0,
            duplicates: dealer_slugs.length 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw error;
    }

    console.log(`[enqueue-dealer-crawl] Queued ${data?.length || 0} ${run_type} jobs`);

    return new Response(
      JSON.stringify({
        message: 'Jobs queued successfully',
        queued: data?.length || 0,
        jobs: data,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[enqueue-dealer-crawl] Error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
