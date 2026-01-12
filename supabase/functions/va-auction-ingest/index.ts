import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 10-year window enforcement
const MIN_YEAR = new Date().getFullYear() - 10;

// Rejection reasons
type RejectionReason = 
  | "YEAR_BELOW_WINDOW"
  | "MISSING_YEAR"
  | "MISSING_MAKE"
  | "MISSING_MODEL"
  | "DUPLICATE_LISTING";

function validateRow(row: any): { valid: boolean; reason?: RejectionReason } {
  if (!row.year) return { valid: false, reason: "MISSING_YEAR" };
  if (row.year < MIN_YEAR) return { valid: false, reason: "YEAR_BELOW_WINDOW" };
  if (!row.make) return { valid: false, reason: "MISSING_MAKE" };
  if (!row.model) return { valid: false, reason: "MISSING_MODEL" };
  return { valid: true };
}

// Generate stable listing_id: VA:{source_key}:{auction_date}:{lot_or_stock_or_vin}
function generateListingId(sourceKey: string, auctionDate: string, row: any): string {
  const identifier = row.lot_id || row.stock_number || row.vin || `row_${row.row_number}`;
  return `VA:${sourceKey}:${auctionDate}:${identifier}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { batch_id } = await req.json();

    if (!batch_id) {
      return new Response(JSON.stringify({ error: "Missing batch_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get batch details
    const { data: batch, error: batchError } = await supabase
      .from("va_upload_batches")
      .select("*")
      .eq("id", batch_id)
      .single();

    if (batchError || !batch) {
      return new Response(JSON.stringify({ error: "Batch not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (batch.status !== "parsed") {
      return new Response(JSON.stringify({ error: "Batch must be in 'parsed' status to ingest" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update status to ingesting
    await supabase
      .from("va_upload_batches")
      .update({ status: "ingesting", ingest_started_at: new Date().toISOString() })
      .eq("id", batch_id);

    // Get all pending rows
    const { data: rows, error: rowsError } = await supabase
      .from("va_upload_rows")
      .select("*")
      .eq("batch_id", batch_id)
      .eq("status", "pending")
      .order("row_number");

    if (rowsError) {
      await supabase
        .from("va_upload_batches")
        .update({ status: "failed", error: "Failed to fetch rows" })
        .eq("id", batch_id);
      
      return new Response(JSON.stringify({ error: "Failed to fetch rows" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create ingestion run record
    const { data: ingestionRun } = await supabase
      .from("ingestion_runs")
      .insert({
        source: `va_upload_${batch.source_key}`,
        status: "running",
        lots_found: rows?.length || 0,
        metadata: { batch_id, source_key: batch.source_key, auction_date: batch.auction_date },
      })
      .select()
      .single();

    let accepted = 0;
    let rejected = 0;
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const row of rows || []) {
      const validation = validateRow(row);
      const listingId = generateListingId(batch.source_key, batch.auction_date, row);

      if (!validation.valid) {
        // Reject row
        await supabase
          .from("va_upload_rows")
          .update({ status: "rejected", rejection_reason: validation.reason })
          .eq("id", row.id);
        rejected++;
        continue;
      }

      // Check for existing listing
      const { data: existing } = await supabase
        .from("vehicle_listings")
        .select("id")
        .eq("listing_id", listingId)
        .single();

      if (existing) {
        // Update existing listing
        const { error: updateError } = await supabase
          .from("vehicle_listings")
          .update({
            year: row.year,
            make: row.make,
            model: row.model,
            variant_raw: row.variant_raw,
            variant_family: row.variant_family,
            km: row.km,
            fuel: row.fuel,
            transmission: row.transmission,
            location: row.location,
            reserve: row.reserve,
            asking_price: row.asking_price,
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        if (updateError) {
          errors.push(`Row ${row.row_number}: Update failed - ${updateError.message}`);
          await supabase
            .from("va_upload_rows")
            .update({ status: "rejected", rejection_reason: "UPDATE_FAILED" })
            .eq("id", row.id);
          rejected++;
        } else {
          // Create snapshot
          await supabase.from("listing_snapshots").insert({
            listing_id: existing.id,
            seen_at: new Date().toISOString(),
            asking_price: row.asking_price,
            reserve: row.reserve,
            km: row.km,
            location: row.location,
            status: "catalogue",
          });

          await supabase
            .from("va_upload_rows")
            .update({ status: "accepted", listing_id: existing.id })
            .eq("id", row.id);
          accepted++;
          updated++;
        }
      } else {
        // Create new listing
        const { data: newListing, error: insertError } = await supabase
          .from("vehicle_listings")
          .insert({
            listing_id: listingId,
            source: `va_${batch.source_key}`,
            source_class: "auction",
            status: "catalogue",
            year: row.year,
            make: row.make,
            model: row.model,
            variant_raw: row.variant_raw,
            variant_family: row.variant_family,
            km: row.km,
            fuel: row.fuel,
            transmission: row.transmission,
            location: row.location,
            reserve: row.reserve,
            asking_price: row.asking_price,
            auction_datetime: batch.auction_date,
            auction_house: batch.source_key,
            lot_id: row.lot_id,
            first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) {
          errors.push(`Row ${row.row_number}: Insert failed - ${insertError.message}`);
          await supabase
            .from("va_upload_rows")
            .update({ status: "rejected", rejection_reason: "INSERT_FAILED" })
            .eq("id", row.id);
          rejected++;
        } else {
          // Create initial snapshot
          await supabase.from("listing_snapshots").insert({
            listing_id: newListing.id,
            seen_at: new Date().toISOString(),
            asking_price: row.asking_price,
            reserve: row.reserve,
            km: row.km,
            location: row.location,
            status: "catalogue",
          });

          await supabase
            .from("va_upload_rows")
            .update({ status: "accepted", listing_id: newListing.id })
            .eq("id", row.id);
          accepted++;
          created++;
        }
      }
    }

    // Update batch with final counts
    await supabase
      .from("va_upload_batches")
      .update({
        status: "completed",
        ingest_completed_at: new Date().toISOString(),
        rows_accepted: accepted,
        rows_rejected: rejected,
        error: errors.length > 0 ? errors.slice(0, 10).join("; ") : null,
      })
      .eq("id", batch_id);

    // Update ingestion run
    if (ingestionRun) {
      await supabase
        .from("ingestion_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          lots_created: created,
          lots_updated: updated,
          errors: errors.length > 0 ? errors : null,
        })
        .eq("id", ingestionRun.id);
    }

    return new Response(JSON.stringify({
      success: true,
      batch_id,
      summary: {
        total: rows?.length || 0,
        accepted,
        rejected,
        created,
        updated,
      },
      errors: errors.slice(0, 10),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(JSON.stringify({ error: "Internal server error", details: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
