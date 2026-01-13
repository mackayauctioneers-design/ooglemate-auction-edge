import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // Check admin role
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

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const sourceKey = formData.get("source_key") as string;
    const auctionDate = formData.get("auction_date") as string;

    if (!file || !sourceKey || !auctionDate) {
      return new Response(JSON.stringify({ error: "Missing required fields: file, source_key, auction_date" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine file type
    const fileName = file.name.toLowerCase();
    let fileType: string;
    if (fileName.endsWith(".csv")) {
      fileType = "csv";
    } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      fileType = "xlsx";
    } else if (fileName.endsWith(".pdf")) {
      fileType = "pdf";
    } else {
      return new Response(JSON.stringify({ error: "Unsupported file type. Use CSV, XLSX, or PDF." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate unique file path
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = `${sourceKey}/${auctionDate}/${timestamp}_${file.name}`;

    // Upload file to storage
    const fileBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from("va-auction-uploads")
      .upload(filePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(JSON.stringify({ error: "Failed to upload file", details: uploadError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PDF uploads get special status - they need manual conversion first
    const status = fileType === "pdf" ? "received_pdf" : "pending";

    // Create batch record
    const { data: batch, error: batchError } = await supabase
      .from("va_upload_batches")
      .insert({
        uploaded_by: user.id,
        source_key: sourceKey,
        auction_date: auctionDate,
        file_name: file.name,
        file_path: filePath,
        file_type: fileType,
        file_size_bytes: file.size,
        status,
        pdf_extract_required: fileType === "pdf",
      })
      .select()
      .single();

    if (batchError) {
      console.error("Batch creation error:", batchError);
      return new Response(JSON.stringify({ error: "Failed to create batch record", details: batchError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      batch_id: batch.id,
      file_path: filePath,
      file_type: fileType,
      message: "File uploaded successfully. Ready for parsing.",
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
