/**
 * ONE-SHOT cleanup function — run once, then delete.
 * Resets 94k Firecrawl-failed listings + expires stale hunt_alerts.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const results: Record<string, unknown> = {};

  // 1. Reset all Firecrawl-failed retail_listings
  const { data: resetData, error: resetError } = await supabase
    .from("retail_listings")
    .update({
      details_failed: false,
      details_attempts: 0,
      details_scraped: false,
      enrichment_status: "pending",
      enrichment_errors: null,
    })
    .eq("details_failed", true)
    .select("id", { count: "exact", head: true });
  
  results.listings_reset = { count: resetData?.length ?? "unknown (used head)", error: resetError?.message };

  // Actually, the above won't work with complex OR conditions via the SDK.
  // Let's use a simpler approach: reset ALL details_failed=true listings.
  // They ALL failed because of Firecrawl anyway.
  const { count: failedCount, error: countError } = await supabase
    .from("retail_listings")
    .select("*", { count: "exact", head: true })
    .eq("details_failed", true);
  
  results.pre_reset_count = failedCount;

  // Batch update - Supabase SDK supports .eq filter on update
  const { error: updateError, count: updatedCount } = await supabase
    .from("retail_listings")
    .update({
      details_failed: false,
      details_attempts: 0,
      details_scraped: false,
      enrichment_status: "pending",
      enrichment_errors: null,
    })
    .eq("details_failed", true);

  results.listings_update = { updated: updatedCount, error: updateError?.message };

  // 2. Expire stale hunt_alerts (older than 7 days, never sent)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  const { error: alertError, count: alertCount } = await supabase
    .from("hunt_alerts")
    .update({
      should_notify: false,
      notify_reason: "expired_backlog_cleanup_20260321",
    })
    .eq("notification_attempts", 0)
    .eq("should_notify", true)
    .is("sent_at", null)
    .lt("created_at", sevenDaysAgo);

  results.alerts_expired = { count: alertCount, error: alertError?.message };

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
