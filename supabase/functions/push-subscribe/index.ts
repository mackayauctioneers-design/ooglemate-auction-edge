import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const { dealer_name, endpoint, keys_p256dh, keys_auth, enabled, user_id } = await req.json();

    if (!dealer_name) {
      return new Response(
        JSON.stringify({ error: 'dealer_name is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    // If disabling
    if (enabled === false) {
      await supabase
        .from('push_subscriptions')
        .update({ enabled: false })
        .eq('dealer_name', dealer_name)
        .eq('endpoint', endpoint || '');

      return new Response(
        JSON.stringify({ success: true, message: 'Subscription disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Upsert subscription
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({
        dealer_name,
        endpoint,
        keys_p256dh,
        keys_auth,
        enabled: true,
        user_id: user_id || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'dealer_name,endpoint' });

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, message: 'Subscription saved' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Push subscribe error:', error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
