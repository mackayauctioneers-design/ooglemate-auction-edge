import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Alert Notifier - Sends Kiting Mode BUY/WATCH alerts to dealers
 * Runs every 5 minutes via cron
 * Channels: email (primary), Slack (optional)
 */

interface HuntAlertRow {
  id: string;
  hunt_id: string;
  listing_id: string;
  alert_type: string;
  created_at: string;
  payload: {
    year?: number;
    make?: string;
    model?: string;
    variant?: string;
    km?: number;
    asking_price?: number;
    proven_exit_value?: number;
    gap_dollars?: number;
    gap_pct?: number;
    source?: string;
    listing_url?: string;
    reasons?: string[];
    state?: string;
    suburb?: string;
  };
  notification_attempts: number;
  should_notify: boolean;
  sent_at: string | null;
}

interface DealerSettings {
  dealer_id: string;
  email: string | null;
  phone: string | null;
  slack_webhook_url: string | null;
  notify_buy: boolean;
  notify_watch: boolean;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
}

interface HuntRow {
  id: string;
  dealer_id: string;
  year: number;
  make: string;
  model: string;
}

// Check if current AEST time is within quiet hours
function isWithinQuietHours(start: number | null, end: number | null): boolean {
  if (start === null || end === null) return false;
  
  const now = new Date();
  // Convert to AEST (UTC+10)
  const aestHour = (now.getUTCHours() + 10) % 24;
  
  if (start <= end) {
    // Simple range (e.g., 22:00 - 07:00 wraps around midnight)
    return aestHour >= start && aestHour < end;
  } else {
    // Wraps around midnight
    return aestHour >= start || aestHour < end;
  }
}

// Format alert for email
function formatEmailHtml(alert: HuntAlertRow): string {
  const p = alert.payload;
  const vehicle = `${p.year || ''} ${p.make || ''} ${p.model || ''} ${p.variant || ''}`.trim();
  const km = p.km ? `${(p.km / 1000).toFixed(0)}k km` : 'KM unknown';
  const askingPrice = p.asking_price ? `$${p.asking_price.toLocaleString()}` : '-';
  const exitValue = p.proven_exit_value ? `$${p.proven_exit_value.toLocaleString()}` : '-';
  const gap = p.gap_dollars ? `+$${p.gap_dollars.toLocaleString()} (${(p.gap_pct || 0).toFixed(1)}%)` : '-';
  const source = p.source || 'unknown';
  const location = [p.suburb, p.state].filter(Boolean).join(', ') || 'Location unknown';
  const reasons = p.reasons?.slice(0, 2).join(' • ') || '';
  
  const alertColor = alert.alert_type === 'BUY' ? '#22c55e' : '#f59e0b';
  const alertLabel = alert.alert_type === 'BUY' ? '🎯 BUY ALERT' : '👀 WATCH ALERT';
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px;">
  <div style="max-width: 480px; margin: 0 auto; background: #1e293b; border-radius: 12px; overflow: hidden;">
    <div style="background: ${alertColor}; color: white; padding: 16px 20px; font-weight: 600; font-size: 18px;">
      ${alertLabel}
    </div>
    <div style="padding: 20px;">
      <h2 style="margin: 0 0 8px; font-size: 20px; color: #f8fafc;">${vehicle}</h2>
      <p style="margin: 0 0 16px; color: #94a3b8; font-size: 14px;">${km} • ${source} • ${location}</p>
      
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #334155; color: #94a3b8;">Asking Price</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #334155; text-align: right; font-weight: 600;">${askingPrice}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #334155; color: #94a3b8;">Proven Exit</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #334155; text-align: right; font-weight: 600;">${exitValue}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #94a3b8;">Gap</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: ${alertColor};">${gap}</td>
        </tr>
      </table>
      
      ${reasons ? `<p style="margin: 16px 0 0; padding: 12px; background: #0f172a; border-radius: 8px; font-size: 13px; color: #94a3b8;">${reasons}</p>` : ''}
      
      ${p.listing_url ? `
      <a href="${p.listing_url}" target="_blank" style="display: block; margin-top: 20px; padding: 14px; background: ${alertColor}; color: white; text-align: center; text-decoration: none; border-radius: 8px; font-weight: 600;">
        View Listing →
      </a>
      ` : ''}
    </div>
    <div style="padding: 16px 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b;">
      Kiting Mode Alert • Sent automatically
    </div>
  </div>
</body>
</html>
  `;
}

// Format alert for Slack
function formatSlackMessage(alert: HuntAlertRow): object {
  const p = alert.payload;
  const vehicle = `${p.year || ''} ${p.make || ''} ${p.model || ''} ${p.variant || ''}`.trim();
  const km = p.km ? `${(p.km / 1000).toFixed(0)}k km` : 'KM unknown';
  const askingPrice = p.asking_price ? `$${p.asking_price.toLocaleString()}` : '-';
  const gap = p.gap_dollars ? `+$${p.gap_dollars.toLocaleString()} (${(p.gap_pct || 0).toFixed(1)}%)` : '-';
  const emoji = alert.alert_type === 'BUY' ? '🎯' : '👀';
  
  return {
    text: `${emoji} *${alert.alert_type} ALERT*: ${vehicle}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *${alert.alert_type} ALERT*\n*${vehicle}*\n${km} • ${p.source || 'unknown'}\n\nAsking: ${askingPrice} | Gap: ${gap}`
        }
      },
      ...(p.listing_url ? [{
        type: "actions",
        elements: [{
          type: "button",
          text: { type: "plain_text", text: "View Listing" },
          url: p.listing_url
        }]
      }] : [])
    ]
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Email sending via fetch to Resend API (no npm import needed)
    const resendKey = Deno.env.get("RESEND_API_KEY");

    // Fetch pending alerts (limit 50 per run)
    const { data: pendingAlerts, error: alertsError } = await supabase
      .from("hunt_alerts")
      .select("*")
      .eq("should_notify", true)
      .is("sent_at", null)
      .lt("notification_attempts", 3)
      .order("created_at", { ascending: true })
      .limit(50);

    if (alertsError) {
      throw new Error(`Failed to fetch alerts: ${alertsError.message}`);
    }

    if (!pendingAlerts || pendingAlerts.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: "No pending alerts",
        duration_ms: Date.now() - startTime
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`Processing ${pendingAlerts.length} pending alerts`);

    // Get unique hunt IDs to fetch dealer info
    const huntIds = [...new Set(pendingAlerts.map(a => a.hunt_id))];
    
    const { data: hunts } = await supabase
      .from("sale_hunts")
      .select("id, dealer_id, year, make, model")
      .in("id", huntIds);

    const huntMap = new Map<string, HuntRow>();
    hunts?.forEach(h => huntMap.set(h.id, h));

    // Get dealer notification settings
    const dealerIds = [...new Set(hunts?.map(h => h.dealer_id) || [])];
    
    const { data: dealerSettings } = await supabase
      .from("dealer_notification_settings")
      .select("*")
      .in("dealer_id", dealerIds);

    const settingsMap = new Map<string, DealerSettings>();
    dealerSettings?.forEach(s => settingsMap.set(s.dealer_id, s));

    // Also get dealer profiles for email fallback
    const { data: dealerProfiles } = await supabase
      .from("dealer_profiles")
      .select("id, dealer_name")
      .in("id", dealerIds);

    const profileMap = new Map<string, { id: string; dealer_name: string }>();
    dealerProfiles?.forEach(p => profileMap.set(p.id, p));

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const alert of pendingAlerts as HuntAlertRow[]) {
      const hunt = huntMap.get(alert.hunt_id);
      if (!hunt) {
        console.log(`Hunt not found for alert ${alert.id}`);
        skipped++;
        continue;
      }

      const settings = settingsMap.get(hunt.dealer_id);
      const profile = profileMap.get(hunt.dealer_id);

      // Check alert type preference
      const shouldNotifyBuy = settings?.notify_buy ?? true;
      const shouldNotifyWatch = settings?.notify_watch ?? false;
      
      if (alert.alert_type === 'BUY' && !shouldNotifyBuy) {
        skipped++;
        await supabase.from("hunt_alerts")
          .update({ should_notify: false, notify_reason: "BUY notifications disabled" })
          .eq("id", alert.id);
        continue;
      }
      
      if (alert.alert_type === 'WATCH' && !shouldNotifyWatch) {
        skipped++;
        await supabase.from("hunt_alerts")
          .update({ should_notify: false, notify_reason: "WATCH notifications disabled" })
          .eq("id", alert.id);
        continue;
      }

      // Check quiet hours
      if (isWithinQuietHours(settings?.quiet_hours_start ?? null, settings?.quiet_hours_end ?? null)) {
        console.log(`Alert ${alert.id} delayed: quiet hours`);
        skipped++;
        continue;
      }

      // Try to send notification
      let sentVia: string | null = null;
      let lastError: string | null = null;

      // Priority 1: Email via Resend API
      if (resendKey && settings?.email) {
        try {
          const vehicle = `${alert.payload.year || ''} ${alert.payload.make || ''} ${alert.payload.model || ''}`.trim();
          const subject = `${alert.alert_type === 'BUY' ? '🎯' : '👀'} ${alert.alert_type} Alert: ${vehicle}`;
          
          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "Kiting Mode <alerts@resend.dev>",
              to: [settings.email],
              subject,
              html: formatEmailHtml(alert),
            }),
          });
          
          if (emailRes.ok) {
            sentVia = "email";
          } else {
            const emailErr = await emailRes.json();
            lastError = emailErr.message || `Email API error: ${emailRes.status}`;
            console.error(`Email failed for ${alert.id}:`, lastError);
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          console.error(`Email failed for ${alert.id}:`, lastError);
        }
      }

      // Priority 2: Slack webhook
      if (!sentVia && settings?.slack_webhook_url) {
        try {
          const res = await fetch(settings.slack_webhook_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formatSlackMessage(alert)),
          });
          if (res.ok) {
            sentVia = "slack";
          } else {
            lastError = `Slack webhook error: ${res.status}`;
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          console.error(`Slack failed for ${alert.id}:`, lastError);
        }
      }

      // Update alert status
      if (sentVia) {
        await supabase.from("hunt_alerts")
          .update({ 
            sent_at: new Date().toISOString(),
            notification_channel: sentVia,
            notify_reason: `Sent via ${sentVia}`
          })
          .eq("id", alert.id);
        sent++;
      } else if (!settings?.email && !settings?.slack_webhook_url) {
        // No channels configured - mark as skipped
        await supabase.from("hunt_alerts")
          .update({ 
            should_notify: false,
            notify_reason: "No notification channels configured"
          })
          .eq("id", alert.id);
        skipped++;
      } else {
        // Increment attempt counter
        await supabase.from("hunt_alerts")
          .update({ 
            notification_attempts: alert.notification_attempts + 1,
            last_notification_error: lastError
          })
          .eq("id", alert.id);
        failed++;
        if (lastError) errors.push(lastError);
      }
    }

    // Log to cron audit
    await supabase.from("cron_audit_log").insert({
      cron_name: "alert-notifier",
      run_date: new Date().toISOString().slice(0, 10),
      success: failed === 0,
      result: { sent, skipped, failed, errors: errors.slice(0, 5) },
    });

    console.log(`Alert notifier complete: ${sent} sent, ${skipped} skipped, ${failed} failed`);

    return new Response(JSON.stringify({
      success: true,
      sent,
      skipped,
      failed,
      duration_ms: Date.now() - startTime,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Alert notifier error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    }), { 
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
