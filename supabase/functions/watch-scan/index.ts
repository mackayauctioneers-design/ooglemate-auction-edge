import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WatchItem {
  id: string;
  account_id: string;
  watch_type: string;
  source: string;
  url: string;
  trigger_type: string;
  trigger_value: string;
  last_snapshot: Record<string, any> | null;
  last_hash: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { watch_id } = await req.json();

    if (!watch_id) {
      throw new Error("watch_id is required");
    }

    // Fetch the watch item
    const { data: watch, error: watchError } = await supabase
      .from("url_watchlist")
      .select("*")
      .eq("id", watch_id)
      .single();

    if (watchError || !watch) {
      throw new Error(`Watch not found: ${watchError?.message}`);
    }

    console.log(`Scanning watch: ${watch.url}`);

    // Try to fetch the URL
    let fetchResult: { price?: number; status?: string; title?: string; error?: string };
    
    try {
      const response = await fetch(watch.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (!response.ok) {
        if (response.status === 403 || response.status === 503) {
          // WAF blocked - log as error event
          await supabase.from("watch_events").insert({
            watch_id: watch.id,
            account_id: watch.account_id,
            event_type: "blocked",
            details: { status: response.status, message: "WAF or rate limit blocked" },
          });

          await supabase
            .from("url_watchlist")
            .update({ last_scan_at: new Date().toISOString() })
            .eq("id", watch.id);

          return new Response(
            JSON.stringify({ success: true, event_type: "blocked", message: "WAF blocked - queued for external scan" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();

      // Simple price extraction - looks for common patterns
      const priceMatch = html.match(/\$[\d,]+(?:\.\d{2})?/);
      const price = priceMatch ? parseInt(priceMatch[0].replace(/[$,]/g, "")) : undefined;

      // Check for sold/unavailable indicators
      const soldPatterns = [/sold/i, /unavailable/i, /no longer available/i, /removed/i];
      const isSold = soldPatterns.some((p) => p.test(html));

      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : undefined;

      fetchResult = {
        price,
        status: isSold ? "sold" : "active",
        title,
      };
    } catch (fetchErr) {
      console.error("Fetch error:", fetchErr);
      fetchResult = { error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) };
    }

    // Generate hash for change detection
    const currentHash = JSON.stringify(fetchResult);
    const previousHash = watch.last_hash;
    const previousSnapshot = watch.last_snapshot || {};

    // Determine if trigger conditions are met
    let eventType: string | null = null;
    let triggerHit = false;
    const details: Record<string, any> = { ...fetchResult };

    if (fetchResult.error) {
      eventType = "error";
    } else if (currentHash !== previousHash) {
      // Something changed
      const priceBefore = previousSnapshot.price;
      const priceNow = fetchResult.price;

      if (previousSnapshot.status === "active" && fetchResult.status === "sold") {
        eventType = "removed";
      } else if (priceBefore && priceNow && priceNow < priceBefore) {
        eventType = "price_drop";
        details.price_before = priceBefore;
        details.price_after = priceNow;
        details.drop_amount = priceBefore - priceNow;
        details.drop_percent = Math.round(((priceBefore - priceNow) / priceBefore) * 100);

        // Check trigger
        switch (watch.trigger_type) {
          case "price_under":
            triggerHit = priceNow < parseInt(watch.trigger_value);
            break;
          case "price_drop_amount":
            triggerHit = (priceBefore - priceNow) >= parseInt(watch.trigger_value);
            break;
          case "price_drop_percent":
            triggerHit = details.drop_percent >= parseInt(watch.trigger_value);
            break;
        }
      } else if (watch.trigger_type === "status_change") {
        eventType = "status_change";
        triggerHit = true;
      } else {
        eventType = "scan_complete";
      }
    } else {
      eventType = "scan_complete";
    }

    // Insert event if meaningful
    if (eventType && (eventType !== "scan_complete" || triggerHit)) {
      await supabase.from("watch_events").insert({
        watch_id: watch.id,
        account_id: watch.account_id,
        event_type: triggerHit ? "trigger_hit" : eventType,
        details: { ...details, trigger_hit: triggerHit },
      });
    }

    // Update watch item
    await supabase
      .from("url_watchlist")
      .update({
        last_scan_at: new Date().toISOString(),
        last_snapshot: fetchResult.error ? watch.last_snapshot : fetchResult,
        last_hash: fetchResult.error ? watch.last_hash : currentHash,
      })
      .eq("id", watch.id);

    // If trigger hit, optionally push to candidate queue
    if (triggerHit && watch.watch_type === "single_listing") {
      // Add to pickles_detail_queue as grok_watch source
      await supabase.from("pickles_detail_queue").upsert(
        {
          source: "grok_watch",
          detail_url: watch.url,
          source_listing_id: `watch_${watch.id}`,
          account_id: watch.account_id,
          crawl_status: "pending",
          asking_price: fetchResult.price,
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "source,source_listing_id" }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        event_type: eventType,
        trigger_hit: triggerHit,
        price: fetchResult.price,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Watch scan error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
