import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { derivePlatform, extractBadge, extractSeries } from "../_shared/taxonomy/derivePlatform.ts";
import { writeSoldVehicle } from "../_shared/sales-truth/writeSoldVehicle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Known account_id aliases → real UUIDs
const ACCOUNT_ALIASES: Record<string, string> = {
  "easycars-default": "d24da4ea-f500-47fd-9b66-d2c9aa2d3f51",
};
const DEFAULT_ACCOUNT_ID = "d24da4ea-f500-47fd-9b66-d2c9aa2d3f51";

/** Resolve account_id: accept UUID or known alias */
function resolveAccountId(raw: string | undefined | null): string {
  if (!raw) return DEFAULT_ACCOUNT_ID;
  const trimmed = raw.trim();
  if (ACCOUNT_ALIASES[trimmed]) return ACCOUNT_ALIASES[trimmed];
  // Accept valid UUID format
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return trimmed;
  // Fallback to default
  console.warn(`[easycars-invoice-ingest] Unknown account_id "${trimmed}", using default`);
  return DEFAULT_ACCOUNT_ID;
}

/** Extract structured vehicle data from PDF via AI */
async function extractFromPdf(pdfBase64: string): Promise<any[]> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.error("[easycars-invoice-ingest] LOVABLE_API_KEY not set, skipping PDF extraction");
    return [];
  }

  const systemPrompt = `You are an Australian automotive invoice data extractor. Given a PDF invoice from EasyCars (mailer@easycars.com.au), extract ALL vehicle sale records.

For EACH vehicle, return a JSON object with these fields:
- seller_name: string (the SELLING dealer/person — appears as "From"/"Vendor"/"Seller")
- seller_abn: string or null (ABN of the seller; digits only OK)
- buyer_name: string (the purchasing dealer/person)
- buyer_email: string or null
- buyer_abn: string or null
- make: string (vehicle make e.g. "FORD")
- model: string (vehicle model e.g. "RANGER")
- variant: string or null (trim/badge e.g. "XLT")
- year: number (manufacture year, derived from build_date MM/YY if needed)
- vin: string or null
- rego_plate: string or null
- sale_price: number (GST-inclusive selling price in dollars)
- buy_price: number or null (cost/purchase price)
- sale_date: string or null (ISO date YYYY-MM-DD)
- stock_no: string or null
- km: number or null (odometer reading)
- invoice_number: string or null

Return a JSON array of objects. If you cannot extract any vehicles, return [].
Do NOT wrap in markdown code blocks. Return raw JSON only.`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 50000);

    const response = await fetch("https://ai.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:application/pdf;base64,${pdfBase64}` },
              },
              { type: "text", text: "Extract all vehicle sale records from this EasyCars invoice PDF." },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 8000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const body = await response.text();
      console.error(`[easycars-invoice-ingest] AI error ${response.status}:`, body.slice(0, 500));
      return [];
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";
    
    // Parse JSON from response (strip markdown code blocks if present)
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err: any) {
    console.error("[easycars-invoice-ingest] PDF extraction error:", err.message);
    return [];
  }
}

/** Upsert buyer fingerprint from extracted invoice data */
async function upsertBuyerFingerprint(
  supabase: any,
  accountId: string,
  buyer_name: string,
  buyer_email: string | null,
  make: string,
  model: string,
  salePrice: number | null,
  saleDate: string | null,
  vehicleSummary: string
) {
  if (!buyer_name) return;

  try {
    // Fetch existing fingerprint
    let query = supabase
      .from("buyer_fingerprints")
      .select("*")
      .eq("buyer_name", buyer_name);
    
    if (buyer_email) {
      query = query.eq("buyer_email", buyer_email);
    } else {
      query = query.is("buyer_email", null);
    }

    const { data: existing } = await query.maybeSingle();

    if (existing) {
      // Update existing fingerprint
      const makes = Array.from(new Set([...(existing.makes_purchased || []), make.toUpperCase()]));
      const models = Array.from(new Set([...(existing.models_purchased || []), model.toUpperCase()]));
      const totalPurchases = (existing.total_purchases || 0) + 1;
      
      let priceBandMin = existing.price_band_min;
      let priceBandMax = existing.price_band_max;
      if (salePrice) {
        priceBandMin = priceBandMin ? Math.min(priceBandMin, salePrice) : salePrice;
        priceBandMax = priceBandMax ? Math.max(priceBandMax, salePrice) : salePrice;
      }

      const recentVehicles = [...(existing.recent_vehicles || [])];
      recentVehicles.push({ vehicle: vehicleSummary, price: salePrice, date: saleDate });
      // Keep last 20
      if (recentVehicles.length > 20) recentVehicles.splice(0, recentVehicles.length - 20);

      const avgPrice = salePrice && existing.avg_purchase_price
        ? Math.round(((existing.avg_purchase_price * existing.total_purchases) + salePrice) / totalPurchases)
        : salePrice || existing.avg_purchase_price;

      const { error } = await supabase
        .from("buyer_fingerprints")
        .update({
          makes_purchased: makes,
          models_purchased: models,
          price_band_min: priceBandMin,
          price_band_max: priceBandMax,
          last_purchase_date: saleDate || existing.last_purchase_date,
          total_purchases: totalPurchases,
          avg_purchase_price: avgPrice,
          recent_vehicles: recentVehicles,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (error) console.error(`[buyer-fingerprint] Update error for ${buyer_name}:`, error.message);
      else console.log(`[buyer-fingerprint] Updated: ${buyer_name} (${totalPurchases} purchases)`);
    } else {
      // Insert new fingerprint
      const { error } = await supabase.from("buyer_fingerprints").insert({
        buyer_name,
        buyer_email: buyer_email || null,
        account_id: accountId,
        makes_purchased: [make.toUpperCase()],
        models_purchased: [model.toUpperCase()],
        price_band_min: salePrice,
        price_band_max: salePrice,
        last_purchase_date: saleDate,
        total_purchases: 1,
        avg_purchase_price: salePrice,
        recent_vehicles: [{ vehicle: vehicleSummary, price: salePrice, date: saleDate }],
      });

      if (error) console.error(`[buyer-fingerprint] Insert error for ${buyer_name}:`, error.message);
      else console.log(`[buyer-fingerprint] Created: ${buyer_name}`);
    }
  } catch (err: any) {
    console.error(`[buyer-fingerprint] Error for ${buyer_name}:`, err.message);
  }
}

/** Trigger fingerprint-match-run for routing alerts */
async function triggerMatchRun(accountId: string) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const res = await fetch(`${supabaseUrl}/functions/v1/fingerprint-match-run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ account_id: accountId }),
    });
    const result = await res.json();
    console.log(`[easycars-invoice-ingest] fingerprint-match-run:`, JSON.stringify(result));
    return result;
  } catch (err: any) {
    console.error(`[easycars-invoice-ingest] fingerprint-match-run failed:`, err.message);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: verify shared secret
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const expectedSecret = Deno.env.get("LINDY_WEBHOOK_SECRET");

    if (!expectedSecret || token !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Accept single sale or array of sales
    const sales: any[] = Array.isArray(body) ? body : [body];

    // ── Check for PDF attachments needing AI extraction ──
    const pdfSales: any[] = [];
    const jsonSales: any[] = [];

    for (const s of sales) {
      if (s.pdf_base64) {
        // Has PDF attachment — extract via AI
        console.log(`[easycars-invoice-ingest] Extracting from PDF (${Math.round(s.pdf_base64.length / 1024)}KB)`);
        const extracted = await extractFromPdf(s.pdf_base64);
        console.log(`[easycars-invoice-ingest] Extracted ${extracted.length} vehicles from PDF`);
        for (const v of extracted) {
          pdfSales.push({ ...v, account_id: s.account_id, _from_pdf: true });
        }
      } else if (s.make || s.description) {
        jsonSales.push(s);
      }
    }

    const allSales = [...jsonSales, ...pdfSales];

    if (allSales.length === 0) {
      return new Response(
        JSON.stringify({ error: "No valid sale records in payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Build sale records ──
    const records = allSales
      .filter((s) => s.make || s.description)
      .map((s) => {
        const make = (s.make || "").toUpperCase();
        const model = (s.model || "").toUpperCase();
        const variantText = s.variant || s.description || "";
        const accountId = resolveAccountId(s.account_id);
        return {
          account_id: accountId,
          make: make || null,
          model: model || null,
          variant: s.variant || null,
          year: s.year ? parseInt(String(s.year)) : null,
          sold_at: s.sold_at || s.sale_date || s.invoice_date || null,
          sale_price: s.sale_price ? Math.round(Number(s.sale_price)) : null,
          buy_price: s.buy_price || s.cost_price ? Math.round(Number(s.buy_price || s.cost_price)) : null,
          days_to_clear: s.days_to_clear || s.days_in_stock ? parseInt(String(s.days_to_clear || s.days_in_stock)) : null,
          km: s.km || s.kilometres ? parseInt(String(s.km || s.kilometres)) : null,
          body_type: s.body_type || null,
          transmission: s.transmission || null,
          fuel_type: s.fuel_type || null,
          drive_type: s.drive_type || null,
          platform_class: derivePlatform(make, model),
          series: extractSeries(make, model) || null,
          badge: extractBadge(variantText) || null,
          source: s._from_pdf ? "easycars_invoice_pdf" : "easycars_invoice_gmail",
          confidence: "high",
          notes: [
            s.stock_no ? `Stock #${s.stock_no}` : null,
            s.vin ? `VIN: ${s.vin}` : null,
            s.rego_plate ? `Rego: ${s.rego_plate}` : null,
            s.invoice_number ? `Invoice: ${s.invoice_number}` : null,
            s.km || s.kilometres ? `KM: ${s.km || s.kilometres}` : null,
            s.buyer_name ? `Buyer: ${s.buyer_name}` : null,
          ]
            .filter(Boolean)
            .join(" | ") || null,
          // Internal fields (not stored in vehicle_sales_truth) — used for downstream
          // buyer-fingerprint upsert and Mackay sold_vehicles write.
          _buyer_name: s.buyer_name || null,
          _buyer_email: s.buyer_email || null,
          _resolved_account_id: resolveAccountId(s.account_id),
          _seller_abn: s.seller_abn || null,
          _vin: s.vin || null,
          _odo: s.km || s.kilometres || null,
        };
      });

    if (records.length === 0) {
      return new Response(
        JSON.stringify({ error: "No valid sale records after processing" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Insert into vehicle_sales_truth (strip internal fields) ──
    const dbRecords = records.map(({ _buyer_name, _buyer_email, _resolved_account_id, ...rest }) => rest);

    const { error } = await supabase
      .from("vehicle_sales_truth")
      .insert(dbRecords);

    if (error) throw error;

    console.log(`[easycars-invoice-ingest] Inserted ${dbRecords.length} sale(s)`);

    // ── Upsert buyer fingerprints ──
    let fingerprintsUpserted = 0;
    for (const r of records) {
      if (r._buyer_name && r.make) {
        await upsertBuyerFingerprint(
          supabase,
          r._resolved_account_id,
          r._buyer_name,
          r._buyer_email,
          r.make,
          r.model || "",
          r.sale_price,
          r.sold_at,
          `${r.year || ""} ${r.make} ${r.model || ""}`.trim()
        );
        fingerprintsUpserted++;
      }
    }

    // ── Trigger matching engine ──
    let matchResult = null;
    if (fingerprintsUpserted > 0) {
      const accountId = records[0]?._resolved_account_id || DEFAULT_ACCOUNT_ID;
      matchResult = await triggerMatchRun(accountId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        inserted: dbRecords.length,
        pdf_extracted: pdfSales.length,
        fingerprints_upserted: fingerprintsUpserted,
        match_triggered: !!matchResult,
        sales: dbRecords.map((r) => `${r.year} ${r.make} ${r.model}`),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[easycars-invoice-ingest] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
