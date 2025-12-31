import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// AEST timezone offset (+10 hours, or +11 during daylight saving)
function getAESTHour(): number {
  const now = new Date();
  // Get UTC hours and add 10 for AEST (or 11 for AEDT)
  // For simplicity, using AEST (+10). For production, consider proper timezone handling.
  const utcHours = now.getUTCHours();
  const aestHours = (utcHours + 10) % 24;
  return aestHours;
}

function isWithinSendWindow(): boolean {
  const hour = getAESTHour();
  return hour >= 7 && hour < 19; // 07:00 - 19:00 AEST
}

async function sendWhatsAppMessage(
  to: string,
  message: string
): Promise<{ success: boolean; error?: string; sid?: string }> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber = Deno.env.get('TWILIO_WHATSAPP_FROM');

  console.log('Twilio config check:', {
    hasSid: !!accountSid,
    sidLength: accountSid?.length,
    sidPrefix: accountSid?.substring(0, 4),
    hasToken: !!authToken,
    tokenLength: authToken?.length,
    fromNumber: fromNumber,
  });

  if (!accountSid || !authToken || !fromNumber) {
    return { success: false, error: 'Missing Twilio configuration' };
  }

  // Ensure numbers are in WhatsApp format
  const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const formattedFrom = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;

  console.log('Sending WhatsApp:', { to: formattedTo, from: formattedFrom });

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const credentials = btoa(`${accountSid}:${authToken}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: formattedTo,
        From: formattedFrom,
        Body: message,
      }),
    });

    const data = await response.json();
    console.log('Twilio response:', { status: response.status, data });

    if (!response.ok) {
      console.error('Twilio error details:', JSON.stringify(data));
      return { success: false, error: data.message || data.code || 'Failed to send message' };
    }

    console.log('WhatsApp message sent:', data.sid);
    return { success: true, sid: data.sid };
  } catch (error: unknown) {
    console.error('WhatsApp send error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

function formatAlertMessage(lot: any): string {
  const flagReasons = lot.why_flagged || [];
  const flagBadges = Array.isArray(flagReasons) ? flagReasons.join(', ') : flagReasons;

  return `🚨 *BUY NOW – Auction Match*

${lot.make} ${lot.model} ${lot.variant_normalised || ''}
${lot.auction_house} – ${lot.auction_datetime || 'TBA'}

Margin est: $${Math.round(lot.estimated_margin || 0).toLocaleString()}
Passes: ${lot.pass_count || 0}
Why: ${flagBadges || 'Match criteria met'}

Link: ${lot.listing_url || 'N/A'}`;
}

interface ProcessRequest {
  action: 'send' | 'check-queue' | 'process-queued';
  alert?: any;
  lot?: any;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, alert, lot }: ProcessRequest = await req.json();
    console.log(`WhatsApp alerts: action=${action}`);

    switch (action) {
      case 'send': {
        // Send a single alert
        if (!alert || !lot) {
          return new Response(
            JSON.stringify({ success: false, error: 'Missing alert or lot data' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Check if within send window
        if (!isWithinSendWindow()) {
          console.log('Outside send window (07:00-19:00 AEST), keeping queued');
          return new Response(
            JSON.stringify({ 
              success: true, 
              status: 'queued', 
              reason: 'Outside send window (07:00-19:00 AEST)' 
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const message = formatAlertMessage(lot);
        const result = await sendWhatsAppMessage(alert.recipient_whatsapp, message);

        return new Response(
          JSON.stringify({
            success: result.success,
            status: result.success ? 'sent' : 'failed',
            error: result.error,
            sid: result.sid,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'check-queue': {
        // Check if we're in the send window
        const inWindow = isWithinSendWindow();
        const currentHour = getAESTHour();
        
        return new Response(
          JSON.stringify({
            success: true,
            in_send_window: inWindow,
            current_aest_hour: currentHour,
            window: '07:00-19:00 AEST',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error: unknown) {
    console.error('WhatsApp alerts error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});