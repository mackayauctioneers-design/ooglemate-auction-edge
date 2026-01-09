import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QueueOptions {
  trap_slugs?: string[];
  region_id?: string;
  run_type?: 'validation' | 'cron';
  batch_size?: number;
  // Mix control
  max_adtorque?: number;
  min_digitaldealer?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json() as QueueOptions;
    const { 
      trap_slugs, 
      region_id, 
      run_type = 'validation',
      batch_size = 10,
      max_adtorque,
      min_digitaldealer,
    } = body;

    // Support both explicit slugs and region-based auto-selection
    let slugsToQueue: string[] = trap_slugs || [];

    if (!trap_slugs && region_id) {
      // Auto-select from pending traps with passed preflight
      let query = supabase
        .from('dealer_traps')
        .select('trap_slug, parser_mode')
        .eq('region_id', region_id)
        .eq('enabled', false)
        .eq('validation_status', 'pending')
        .eq('preflight_status', 'pass')
        .order('created_at', { ascending: true })
        .limit(batch_size * 2); // Fetch extra for mix control

      const { data: candidates, error: fetchError } = await query;
      if (fetchError) throw fetchError;

      if (!candidates || candidates.length === 0) {
        return new Response(
          JSON.stringify({ 
            message: 'No eligible traps with passed preflight',
            queued: 0,
            region_id,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Apply mix control
      const adtorque = candidates.filter(c => c.parser_mode === 'adtorque');
      const digitaldealer = candidates.filter(c => c.parser_mode === 'digitaldealer');
      const selected: string[] = [];

      // For Sydney: max 6 AdTorque, min 4 DigitalDealer
      // For Hunter: prioritize DigitalDealer first
      const maxAT = max_adtorque ?? (region_id === 'NSW_SYDNEY_METRO' ? 6 : batch_size);
      const minDD = min_digitaldealer ?? (region_id === 'NSW_SYDNEY_METRO' ? 4 : 0);

      // Add DigitalDealer first (up to minDD or available)
      const ddToAdd = Math.min(minDD, digitaldealer.length, batch_size);
      for (let i = 0; i < ddToAdd; i++) {
        selected.push(digitaldealer[i].trap_slug);
      }

      // Add AdTorque (up to maxAT)
      const atToAdd = Math.min(maxAT, adtorque.length, batch_size - selected.length);
      for (let i = 0; i < atToAdd; i++) {
        selected.push(adtorque[i].trap_slug);
      }

      // Fill remaining with DigitalDealer
      const remainingSlots = batch_size - selected.length;
      for (let i = ddToAdd; i < digitaldealer.length && selected.length < batch_size; i++) {
        selected.push(digitaldealer[i].trap_slug);
      }

      slugsToQueue = selected;
    }

    if (!slugsToQueue || slugsToQueue.length === 0) {
      return new Response(
        JSON.stringify({ error: 'trap_slugs array or region_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!['validation', 'cron'].includes(run_type)) {
      return new Response(
        JSON.stringify({ error: 'run_type must be "validation" or "cron"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert jobs
    const jobs = slugsToQueue.map((slug: string) => ({
      trap_slug: slug,
      run_type,
    }));

    const { data, error } = await supabase
      .from('trap_crawl_jobs')
      .insert(jobs)
      .select('id, trap_slug, run_type, status');

    if (error) {
      if (error.code === '23505') {
        return new Response(
          JSON.stringify({ 
            message: 'Jobs already queued or processing',
            queued: 0,
            duplicates: slugsToQueue.length 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw error;
    }

    // Get parser mode breakdown for reporting
    const { data: trapInfo } = await supabase
      .from('dealer_traps')
      .select('trap_slug, parser_mode')
      .in('trap_slug', slugsToQueue);

    const parserBreakdown = {
      adtorque: trapInfo?.filter(t => t.parser_mode === 'adtorque').length || 0,
      digitaldealer: trapInfo?.filter(t => t.parser_mode === 'digitaldealer').length || 0,
    };

    console.log(`[enqueue] Queued ${data?.length || 0} ${run_type} jobs: AT=${parserBreakdown.adtorque}, DD=${parserBreakdown.digitaldealer}`);

    return new Response(
      JSON.stringify({
        message: 'Jobs queued successfully',
        queued: data?.length || 0,
        parser_mix: parserBreakdown,
        jobs: data,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[enqueue] Error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
