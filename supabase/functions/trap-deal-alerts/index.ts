import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TrapDeal {
  id: string;
  listing_id: string;
  trap_slug: string;
  make: string;
  model: string;
  year: number;
  asking_price: number;
  fingerprint_price: number;
  fingerprint_sample: number;
  delta_pct: number;
  deal_label: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const slackWebhookUrl = Deno.env.get("SLACK_WEBHOOK_URL");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get today's strong buy deals with sufficient sample size
    // NOTE: Temporarily lowered to 1 for testing - restore to 10 for production
    const { data: deals, error: dealsError } = await supabase
      .from("trap_deals")
      .select("*")
      .in("deal_label", ["MISPRICED", "STRONG_BUY"])
      .gte("fingerprint_sample", 1)
      .not("fingerprint_price", "is", null)
      .order("delta_pct", { ascending: true });

    if (dealsError) {
      console.error("Error fetching trap deals:", dealsError);
      throw dealsError;
    }

    if (!deals || deals.length === 0) {
      console.log("No strong buy deals found today");
      return new Response(
        JSON.stringify({ success: true, message: "No deals to alert", alerts_created: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${deals.length} strong buy deals`);

    // Insert alerts (dedup by listing_id + alert_date)
    const alertsToInsert = deals.map((d: TrapDeal) => ({
      listing_id: d.id,
      alert_date: new Date().toISOString().split("T")[0],
      deal_label: d.deal_label,
      delta_pct: d.delta_pct,
      fingerprint_sample: d.fingerprint_sample,
      trap_slug: d.trap_slug,
      make: d.make,
      model: d.model,
      year: d.year,
      asking_price: d.asking_price,
      fingerprint_price: d.fingerprint_price,
    }));

    const { data: insertedAlerts, error: insertError } = await supabase
      .from("trap_deal_alerts")
      .upsert(alertsToInsert, { onConflict: "listing_id,alert_date", ignoreDuplicates: true })
      .select();

    if (insertError) {
      console.error("Error inserting alerts:", insertError);
      throw insertError;
    }

    const alertsCreated = insertedAlerts?.length ?? 0;
    console.log(`Created ${alertsCreated} new alerts`);

    // Send Slack notification if webhook configured
    if (slackWebhookUrl && deals.length > 0) {
      const mispriced = deals.filter((d: TrapDeal) => d.deal_label === "MISPRICED");
      const strongBuys = deals.filter((d: TrapDeal) => d.deal_label === "STRONG_BUY");

      const blocks = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "🎯 Trap Deal Alerts",
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${mispriced.length}* mispriced | *${strongBuys.length}* strong buys found today`,
          },
        },
      ];

      // Add top 5 deals
      const topDeals = deals.slice(0, 5);
      for (const deal of topDeals) {
        const deltaStr = deal.delta_pct.toFixed(1);
        const priceStr = new Intl.NumberFormat("en-AU", {
          style: "currency",
          currency: "AUD",
          maximumFractionDigits: 0,
        }).format(deal.asking_price);

        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${deal.year} ${deal.make} ${deal.model}* @ ${deal.trap_slug}\n${priceStr} (*${deltaStr}%* under benchmark)`,
          },
        });
      }

      if (deals.length > 5) {
        blocks.push({
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `_+ ${deals.length - 5} more deals..._`,
            },
          ],
        } as any);
      }

      try {
        const slackRes = await fetch(slackWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocks }),
        });

        if (slackRes.ok) {
          console.log("Slack notification sent");
          // Update slack_sent_at for inserted alerts
          if (insertedAlerts && insertedAlerts.length > 0) {
            await supabase
              .from("trap_deal_alerts")
              .update({ slack_sent_at: new Date().toISOString() })
              .in("id", insertedAlerts.map((a: any) => a.id));
          }
        } else {
          console.error("Slack notification failed:", await slackRes.text());
        }
      } catch (slackError) {
        console.error("Error sending Slack notification:", slackError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        deals_found: deals.length,
        alerts_created: alertsCreated,
        mispriced: deals.filter((d: TrapDeal) => d.deal_label === "MISPRICED").length,
        strong_buys: deals.filter((d: TrapDeal) => d.deal_label === "STRONG_BUY").length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error("Error in trap-deal-alerts:", error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
