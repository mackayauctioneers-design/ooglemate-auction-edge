import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    // Handle CSV with quoted fields containing commas
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

    const { csv_content, dry_run = false } = await req.json();

    if (!csv_content) {
      return new Response(JSON.stringify({ error: "Missing csv_content" }), {
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

    // Transform to pickles_detail_queue format
    const queueItems = rows.map(row => ({
      source: "pickles",
      source_listing_id: row.lotId,
      detail_url: row.listingUrl || `https://www.pickles.com.au/used/details/cars/${row.make}/${row.model}/${row.lotId}`,
      mta: {
        title: row.title,
        year: parseYear(row.year),
        make: row.make?.toUpperCase(),
        model: row.model?.toUpperCase(),
        variant: row.variant,
        km: parseOdometer(row.odometer),
        fuel: row.fuel,
        transmission: row.transmission,
        body_type: row.bodyType,
        location: row.location,
        state: row.state,
        auction_date: row.auctionDate,
        status: row.status,
        vin: row.vin,
        engine: row.engine,
        drive_type: row.driveType,
        seller_notes: row.sellerNotes,
        price: parsePrice(row.price),
      },
      crawl_status: "pending",
      last_seen_at: new Date().toISOString(),
    }));

    if (dry_run) {
      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        rows_parsed: rows.length,
        sample: queueItems.slice(0, 3),
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Batch upsert into pickles_detail_queue
    const batchSize = 100;
    let inserted = 0;
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < queueItems.length; i += batchSize) {
      const batch = queueItems.slice(i, i + batchSize);
      
      const { error: upsertError } = await supabase
        .from("pickles_detail_queue")
        .upsert(batch, {
          onConflict: "source,source_listing_id",
          ignoreDuplicates: false,
        });

      if (upsertError) {
        console.error(`Batch ${i / batchSize + 1} error:`, upsertError);
        errors += batch.length;
      } else {
        inserted += batch.length;
        console.log(`Batch ${i / batchSize + 1}: ${batch.length} rows processed`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      rows_parsed: rows.length,
      inserted,
      errors,
      message: `Seeded ${inserted} rows into pickles_detail_queue`,
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
