import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THROTTLE_PENDING_LIMIT = 50;

interface PicklesRow {
  lotId: string;
  title: string;
  price: string;
  year: string;
  make: string;
  model: string;
  variant: string;
  odometer: string;
  fuel: string;
  transmission: string;
  bodyType: string;
  location: string;
  state: string;
  auctionDate: string;
  status: string;
  vin: string;
  engine: string;
  driveType: string;
  sellerNotes: string;
  listingUrl: string;
}

function parseCSV(content: string): PicklesRow[] {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map(h => h.trim());
  const rows: PicklesRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim().replace(/^"|"$/g, ""));
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^"|"$/g, ""));

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || "";
    });

    if (row.lotId) {
      rows.push(row as unknown as PicklesRow);
    }
  }

  return rows;
}

function parseOdometer(value: string): number | null {
  if (!value) return null;
  const match = value.match(/[\d,]+/);
  if (!match) return null;
  return parseInt(match[0].replace(/,/g, ""));
}

function parseYear(value: string): number | null {
  if (!value) return null;
  const year = parseInt(value);
  return isNaN(year) ? null : year;
}

function parsePrice(value: string): number | null {
  if (!value) return null;
  const price = parseFloat(value.replace(/[^0-9.]/g, ""));
  return isNaN(price) ? null : Math.round(price);
}

function buildResultSummary(row: PicklesRow) {
  return {
    source_type: "pickles_csv",
    lotId: row.lotId,
    title: row.title,
    year: parseYear(row.year),
    make: row.make?.toUpperCase() || null,
    model: row.model?.toUpperCase() || null,
    variant: row.variant || null,
    km: parseOdometer(row.odometer),
    fuel: row.fuel || null,
    transmission: row.transmission || null,
    body_type: row.bodyType || null,
    location: row.location || null,
    state: row.state || null,
    auction_date: row.auctionDate || null,
    auction_status: row.status || null,
    vin: row.vin || null,
    engine: row.engine || null,
    drive_type: row.driveType || null,
    seller_notes: row.sellerNotes || null,
    price: parsePrice(row.price),
  };
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

    // Verify user is admin
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (!roleData || !["admin", "internal"].includes(roleData.role)) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { csv_content, dry_run = false, account_id } = await req.json();

    if (!csv_content) {
      return new Response(JSON.stringify({ error: "Missing csv_content" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!account_id) {
      return new Response(JSON.stringify({ error: "Missing account_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Parsing CSV...");
    const rows = parseCSV(csv_content);
    console.log(`Parsed ${rows.length} rows`);

    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "No valid rows parsed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build dealer_url_queue items with throttling:
    // First THROTTLE_PENDING_LIMIT get status='pending', rest get status='hold'
    const queueItems = rows.map((row, idx) => {
      const detailUrl = row.listingUrl ||
        `https://www.pickles.com.au/used/details/cars/${row.make}/${row.model}/${row.lotId}`;

      return {
        account_id,
        url_canonical: detailUrl,
        url_raw: detailUrl,
        domain: "pickles.com.au",
        dealer_slug: "pickles",
        intent: "discover",
        priority: "normal",
        method: "csv_seed",
        status: idx < THROTTLE_PENDING_LIMIT ? "pending" : "hold",
        grok_class: "api_only",
        result_summary: buildResultSummary(row),
      };
    });

    const pendingCount = queueItems.filter(q => q.status === "pending").length;
    const holdCount = queueItems.filter(q => q.status === "hold").length;

    if (dry_run) {
      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        rows_parsed: rows.length,
        pending_count: pendingCount,
        hold_count: holdCount,
        sample: queueItems.slice(0, 3).map(item => ({
          url_canonical: item.url_canonical,
          status: item.status,
          result_summary: item.result_summary,
        })),
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Batch upsert into dealer_url_queue
    const batchSize = 100;
    let inserted = 0;
    let errors = 0;

    for (let i = 0; i < queueItems.length; i += batchSize) {
      const batch = queueItems.slice(i, i + batchSize);

      const { error: upsertError } = await supabase
        .from("dealer_url_queue")
        .upsert(batch, {
          onConflict: "url_canonical",
          ignoreDuplicates: false,
        });

      if (upsertError) {
        console.error(`Batch ${i / batchSize + 1} error:`, upsertError);
        errors += batch.length;
      } else {
        inserted += batch.length;
        console.log(`Batch ${i / batchSize + 1}: ${batch.length} rows upserted`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      rows_parsed: rows.length,
      inserted,
      pending_count: pendingCount,
      hold_count: holdCount,
      errors,
      message: `Seeded ${inserted} rows into dealer_url_queue (${pendingCount} pending, ${holdCount} on hold)`,
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
