import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Alert Notifier - Sends Kiting Mode BUY/WATCH alerts to dealers
 * Runs every 5 minutes via cron
 * 
 * Notification flow:
 * 1. Find pending hunt_alerts
 * 2. Send browser push via push-send edge function
 * 3. Mark as sent
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
    return aestHour >= start && aestHour < end;
  } else {
    // Wraps around midnight
    return aestHour >= start || aestHour < end;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

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

    // Also get dealer profiles for dealer name (needed for push-send)
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

      // Build notification message
      const p = alert.payload;
      const vehicle = `${p.year || ''} ${p.make || ''} ${p.model || ''}`.trim();
      const gap = p.gap_dollars ? `+$${p.gap_dollars.toLocaleString()}` : '';
      const emoji = alert.alert_type === 'BUY' ? '🎯' : '👀';
      
      // Send browser push via push-send function
      let sentVia: string | null = null;
      let lastError: string | null = null;

      try {
        const pushRes = await fetch(`${supabaseUrl}/functions/v1/push-send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            dealer_name: profile?.dealer_name,
            title: `${emoji} ${alert.alert_type}: ${vehicle}`,
            body: `${p.asking_price ? '$' + p.asking_price.toLocaleString() : ''} ${gap} • ${p.source || 'Kiting Mode'}`,
            url: `/hunts/${alert.hunt_id}`,
            alertId: alert.id,
            force: false, // Respect quiet hours in push-send too
          }),
        });

        if (pushRes.ok) {
          const result = await pushRes.json();
          if (result.sent > 0) {
            sentVia = "browser_push";
          } else if (result.queued) {
            // Queued for quiet hours - don't mark as sent yet
            console.log(`Alert ${alert.id} queued for quiet hours`);
            skipped++;
            continue;
          } else {
            lastError = "No push subscriptions found";
          }
        } else {
          lastError = `Push API error: ${pushRes.status}`;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`Push failed for ${alert.id}:`, lastError);
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
      } else {
        // Increment attempt counter
        await supabase.from("hunt_alerts")
          .update({ 
            notification_attempts: alert.notification_attempts + 1,
            last_notification_error: lastError
          })
          .eq("id", alert.id);
        
        // If no subscriptions, just mark as complete (in-app is always available)
        if (lastError === "No push subscriptions found") {
          await supabase.from("hunt_alerts")
            .update({ 
              sent_at: new Date().toISOString(),
              notification_channel: "in_app_only",
              notify_reason: "No push subscription, in-app available"
            })
            .eq("id", alert.id);
          sent++;
        } else {
          failed++;
          if (lastError) errors.push(lastError);
        }
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
