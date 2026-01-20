import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-key',
};

interface HarvestItem {
  source_listing_id: string;
  detail_url: string;
  search_url?: string;
  page_no?: number;
}

interface IngestPayload {
  source: string;
  run_id?: string;
  items: HarvestItem[];
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate ingest key
    const ingestKey = req.headers.get('x-ingest-key');
    const expectedKey = Deno.env.get('VMA_INGEST_KEY');
    
    if (!ingestKey || ingestKey !== expectedKey) {
      console.error('Invalid or missing x-ingest-key');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse payload
    const payload: IngestPayload = await req.json();
    const { source = 'vma', run_id, items } = payload;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No items provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[ingest-vma] Received ${items.length} items from source=${source}, run_id=${run_id || 'none'}`);

    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Call the existing RPC for batch upsert
    const { data, error } = await supabase.rpc('upsert_harvest_batch', {
      p_source: source,
      p_run_id: run_id || null,
      p_items: items.map(item => ({
        source_listing_id: item.source_listing_id,
        detail_url: item.detail_url,
        search_url: item.search_url ?? null,
        page_no: item.page_no ?? null,
      })),
    });

    if (error) {
      console.error('[ingest-vma] RPC error:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[ingest-vma] RPC result:`, data);

    return new Response(
      JSON.stringify({
        ok: true,
        source,
        run_id,
        items_received: items.length,
        rpc_result: data,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[ingest-vma] Unexpected error:', err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
