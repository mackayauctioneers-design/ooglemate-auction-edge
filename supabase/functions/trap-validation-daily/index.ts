import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Daily batch configuration
const DAILY_CONFIG = {
  NSW_SYDNEY_METRO: { batch_size: 10, max_adtorque: 6, min_digitaldealer: 4 },
  NSW_HUNTER_NEWCASTLE: { batch_size: 5, max_adtorque: 2, min_digitaldealer: 3 },
  NSW_CENTRAL_COAST: { batch_size: 3, max_adtorque: 1, min_digitaldealer: 2 },
  NSW_REGIONAL: { batch_size: 2, max_adtorque: 1, min_digitaldealer: 1 },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const { regions = Object.keys(DAILY_CONFIG), dry_run = false } = body;

    const results: Record<string, { queued: number; parser_mix: Record<string, number> }> = {};
    let totalQueued = 0;

    for (const region of regions) {
      const config = DAILY_CONFIG[region as keyof typeof DAILY_CONFIG];
      if (!config) continue;

      // Fetch eligible traps (preflight passed, not yet enabled, pending validation)
      const { data: candidates } = await supabase
        .from('dealer_traps')
        .select('trap_slug, parser_mode')
        .eq('region_id', region)
        .eq('enabled', false)
        .eq('validation_status', 'pending')
        .eq('preflight_status', 'pass')
        .order('created_at', { ascending: true })
        .limit(config.batch_size * 2);

      if (!candidates || candidates.length === 0) {
        results[region] = { queued: 0, parser_mix: {} };
        continue;
      }

      // Apply mix control
      const adtorque = candidates.filter(c => c.parser_mode === 'adtorque');
      const digitaldealer = candidates.filter(c => c.parser_mode === 'digitaldealer');
      const selected: string[] = [];

      // Add DigitalDealer first (min requirement)
      const ddToAdd = Math.min(config.min_digitaldealer, digitaldealer.length, config.batch_size);
      for (let i = 0; i < ddToAdd; i++) {
        selected.push(digitaldealer[i].trap_slug);
      }

      // Add AdTorque (up to max)
      const atToAdd = Math.min(config.max_adtorque, adtorque.length, config.batch_size - selected.length);
      for (let i = 0; i < atToAdd; i++) {
        selected.push(adtorque[i].trap_slug);
      }

      // Fill remaining with DigitalDealer
      for (let i = ddToAdd; i < digitaldealer.length && selected.length < config.batch_size; i++) {
        selected.push(digitaldealer[i].trap_slug);
      }

      if (selected.length === 0) {
        results[region] = { queued: 0, parser_mix: {} };
        continue;
      }

      if (dry_run) {
        const parserMix = {
          adtorque: selected.filter(s => adtorque.find(a => a.trap_slug === s)).length,
          digitaldealer: selected.filter(s => digitaldealer.find(d => d.trap_slug === s)).length,
        };
        results[region] = { queued: selected.length, parser_mix: parserMix };
        totalQueued += selected.length;
        continue;
      }

      // Insert validation jobs
      const jobs = selected.map(slug => ({
        trap_slug: slug,
        run_type: 'validation',
      }));

      const { data: inserted, error: insertError } = await supabase
        .from('trap_crawl_jobs')
        .insert(jobs)
        .select('trap_slug');

      if (insertError) {
        // Ignore duplicate key errors
        if (insertError.code !== '23505') {
          console.error(`[validation-daily] Insert error for ${region}:`, insertError);
        }
        results[region] = { queued: 0, parser_mix: {} };
        continue;
      }

      const parserMix = {
        adtorque: (inserted || []).filter(i => adtorque.find(a => a.trap_slug === i.trap_slug)).length,
        digitaldealer: (inserted || []).filter(i => digitaldealer.find(d => d.trap_slug === i.trap_slug)).length,
      };

      results[region] = { queued: inserted?.length || 0, parser_mix: parserMix };
      totalQueued += inserted?.length || 0;

      console.log(`[validation-daily] ${region}: queued ${inserted?.length || 0} (AT=${parserMix.adtorque}, DD=${parserMix.digitaldealer})`);
    }

    // Log to cron_audit
    const today = new Date().toISOString().split('T')[0];
    await supabase
      .from('cron_audit_log')
      .upsert({
        cron_name: 'trap-validation-daily',
        run_date: today,
        run_at: new Date().toISOString(),
        success: true,
        result: { total_queued: totalQueued, by_region: results },
      }, { onConflict: 'cron_name,run_date' });

    console.log(`[validation-daily] Complete: ${totalQueued} total jobs queued`);

    return new Response(
      JSON.stringify({
        message: dry_run ? 'Dry run complete' : 'Daily validation enqueue complete',
        total_queued: totalQueued,
        by_region: results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[validation-daily] Error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
