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

    const { trap_slugs, dealer_slugs, run_type = 'validation' } = await req.json();

    // Support both trap_slugs (new) and dealer_slugs (legacy)
    const slugs = trap_slugs || dealer_slugs;

    if (!slugs || !Array.isArray(slugs) || slugs.length === 0) {
      return new Response(
        JSON.stringify({ error: 'trap_slugs array required' }),
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
    const jobs = slugs.map((slug: string) => ({
      trap_slug: slug,
      run_type,
    }));

    const { data, error } = await supabase
      .from('trap_crawl_jobs')
      .insert(jobs)
      .select('id, trap_slug, run_type, status');

    if (error) {
      // Check if it's a unique constraint violation (duplicate job)
      if (error.code === '23505') {
        return new Response(
          JSON.stringify({ 
            message: 'Jobs already queued or processing',
            queued: 0,
            duplicates: slugs.length 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw error;
    }

    console.log(`[enqueue-trap-crawl] Queued ${data?.length || 0} ${run_type} jobs`);

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
    console.error('[enqueue-trap-crawl] Error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
