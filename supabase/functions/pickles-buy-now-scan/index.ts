import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUY_NOW_URL =
  "https://www.pickles.com.au/used/search/cars?filter=and%255B0%255D%255Bor%255D%255B0%255D%255BbuyMethod%255D%3DBuy%2520Now&contentkey=cars-to-buy-now";

interface ScrapedListing {
  url: string;
  year?: number;
  make?: string;
  model?: string;
  variant?: string;
  kms?: number;
  price?: number;
  location?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    console.log("[pickles-buy-now-scan] Starting scrape…");

    // ── 1. Scrape via Firecrawl ──
    const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${firecrawlKey}`,
      },
      body: JSON.stringify({
        url: BUY_NOW_URL,
        formats: ["extract"],
        extract: {
          schema: {
            type: "object",
            properties: {
              listings: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    url: { type: "string" },
                    price: { type: "number" },
                    kms: { type: "number" },
                    location: { type: "string" },
                    year: { type: "integer" },
                    make: { type: "string" },
                    model: { type: "string" },
                    variant: { type: "string" },
                  },
                },
              },
            },
          },
          prompt:
            "Extract every vehicle listing visible on this page. For each listing extract: the full URL (href), the price as a number, the odometer (kms) as a number, the location text, and parse the title into year (integer), make (e.g. Toyota), model (e.g. Hilux), and variant/badge (e.g. SR5). Return all listings in the 'listings' array.",
        },
      }),
    });

    if (!scrapeRes.ok) {
      const errText = await scrapeRes.text();
      throw new Error(`Firecrawl error ${scrapeRes.status}: ${errText}`);
    }

    const scrapeData = await scrapeRes.json();
    const rawListings: ScrapedListing[] =
      scrapeData?.data?.extract?.listings ?? [];

    console.log(`[pickles-buy-now-scan] Extracted ${rawListings.length} listings`);

    if (rawListings.length === 0) {
      return new Response(
        JSON.stringify({ success: true, scraped: 0, inserted: 0, updated: 0, matched: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Upsert with dedup ──
    let inserted = 0;
    let updated = 0;

    for (const listing of rawListings) {
      if (!listing.url) continue;

      // Normalise
      const make = listing.make?.trim() ?? null;
      const model = listing.model?.trim() ?? null;

      const { data: existing } = await supabase
        .from("pickles_buy_now_listings")
        .select("id")
        .eq("listing_url", listing.url)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("pickles_buy_now_listings")
          .update({
            last_seen_at: new Date().toISOString(),
            scraped_at: new Date().toISOString(),
            price: listing.price ?? null,
            kms: listing.kms ?? null,
          })
          .eq("id", existing.id);
        updated++;
      } else {
        await supabase.from("pickles_buy_now_listings").insert({
          listing_url: listing.url,
          year: listing.year ?? null,
          make,
          model,
          variant: listing.variant?.trim() ?? null,
          kms: listing.kms ?? null,
          price: listing.price ?? null,
          location: listing.location?.trim() ?? null,
        });
        inserted++;
      }
    }

    console.log(`[pickles-buy-now-scan] Upserted: ${inserted} new, ${updated} updated`);

    // ── 3. Fingerprint match on NEW unmatched listings ──
    const { data: unmatched } = await supabase
      .from("pickles_buy_now_listings")
      .select("id, year, make, model, variant, kms, price")
      .is("matched_fingerprint_id", null)
      .is("match_alerted_at", null)
      .not("make", "is", null)
      .not("model", "is", null);

    let matched = 0;
    const alerts: {
      listing_id: string;
      listing_url: string;
      listing_summary: string;
      fingerprint_id: string;
      fingerprint_label: string;
      price_delta: number | null;
    }[] = [];

    if (unmatched && unmatched.length > 0) {
      // Fetch active fingerprints (sales_target_candidates with status=active)
      const { data: fingerprints } = await supabase
        .from("sales_target_candidates")
        .select("id, make, model, variant, year_min, year_max, median_km, median_sold_price, target_buy_price, score")
        .eq("status", "active");

      if (fingerprints && fingerprints.length > 0) {
        for (const listing of unmatched) {
          for (const fp of fingerprints) {
            // Required: make + model (case-insensitive)
            if (
              listing.make?.toLowerCase() !== fp.make?.toLowerCase() ||
              listing.model?.toLowerCase() !== fp.model?.toLowerCase()
            ) {
              continue;
            }

            // Flexible: year ±1
            if (listing.year && fp.year_min && fp.year_max) {
              if (listing.year < fp.year_min - 1 || listing.year > fp.year_max + 1) {
                continue;
              }
            }

            // Flexible: kms within ±30%
            if (listing.kms && fp.median_km) {
              const kmLow = fp.median_km * 0.7;
              const kmHigh = fp.median_km * 1.3;
              if (listing.kms < kmLow || listing.kms > kmHigh) {
                continue;
              }
            }

            // Flexible: price <= sold_price or target_buy_price
            const ceiling = fp.target_buy_price ?? fp.median_sold_price;
            if (listing.price && ceiling && listing.price > ceiling) {
              continue;
            }

            // ✅ Match found
            const priceDelta = ceiling && listing.price ? listing.price - ceiling : null;
            const summary = `${listing.year ?? "?"} ${listing.make} ${listing.model} ${listing.variant ?? ""} — ${listing.kms ? listing.kms.toLocaleString() + " km" : "? km"} — $${listing.price?.toLocaleString() ?? "?"}`;

            await supabase
              .from("pickles_buy_now_listings")
              .update({
                matched_fingerprint_id: fp.id,
                match_alerted_at: new Date().toISOString(),
              })
              .eq("id", listing.id);

            alerts.push({
              listing_id: listing.id,
              listing_url: "", // will be fetched if needed
              listing_summary: summary,
              fingerprint_id: fp.id,
              fingerprint_label: `${fp.make} ${fp.model} ${fp.variant ?? ""}`.trim(),
              price_delta: priceDelta,
            });

            matched++;
            break; // one match per listing
          }
        }
      }
    }

    console.log(`[pickles-buy-now-scan] Matched: ${matched}, Alerts: ${alerts.length}`);

    // ── 4. Send Slack alert if matches found ──
    if (alerts.length > 0) {
      const slackUrl = Deno.env.get("SLACK_WEBHOOK_URL");
      if (slackUrl) {
        const blocks = alerts.map((a) => ({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🎯 *Pickles Buy Now Match*\n${a.listing_summary}\nFingerprint: _${a.fingerprint_label}_\nDelta: ${a.price_delta !== null ? `$${a.price_delta.toLocaleString()}` : "n/a"}`,
          },
        }));

        await fetch(slackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocks }),
        }).catch((e) => console.error("[pickles-buy-now-scan] Slack error:", e));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        scraped: rawListings.length,
        inserted,
        updated,
        matched,
        alerts: alerts.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[pickles-buy-now-scan] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
