import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { guide_id } = await req.json();

    if (!guide_id) {
      return new Response(
        JSON.stringify({ error: "guide_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: guide, error: guideErr } = await supabase
      .from("scan_guides")
      .select("*")
      .eq("id", guide_id)
      .single();

    if (guideErr || !guide) {
      return new Response(
        JSON.stringify({ error: "Guide not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!guide.image_path) {
      return new Response(
        JSON.stringify({ error: "No image uploaded" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase.from("scan_guides").update({ status: "identifying" }).eq("id", guide_id);

    // Download image
    const { data: imageData, error: downloadErr } = await supabase.storage
      .from("scan-guide-photos")
      .download(guide.image_path);

    if (downloadErr || !imageData) {
      console.error("[screenshot-identify] Download failed:", downloadErr);
      await supabase.from("scan_guides").update({ status: "failed", error: "Failed to download image" }).eq("id", guide_id);
      return new Response(
        JSON.stringify({ error: "Failed to download image" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const arrayBuffer = await imageData.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const mimeType = imageData.type || "image/jpeg";

    console.log(`[screenshot-identify] Sending image to AI for extraction (guide=${guide_id})`);

    const imageType = guide.image_type || "screenshot";
    const prompt = imageType === "screenshot"
      ? `Analyze this screenshot of a car listing. Extract:
1. Make (manufacturer)
2. Model
3. Variant/trim/series (if visible)
4. Year of manufacture
5. Kilometres (odometer reading)
6. Asking price (in AUD)
7. Source website/domain (if visible)
8. Location (if visible)

Return ONLY a JSON object:
{
  "make": "string or null",
  "model": "string or null",
  "variant": "string or null",
  "year": number or null,
  "km": number or null,
  "price": number or null,
  "source": "domain or null",
  "location": "string or null",
  "confidence": "high/medium/low",
  "notes": "any caveats"
}

Be conservative. If you can't read something clearly, set it to null.
For price, extract the numeric value only (no $ or commas).
For km, extract the numeric value only.`
      : `Analyze this photo of a vehicle. Try to identify:
1. Make (manufacturer)
2. Model
3. Variant/trim (if distinguishable)
4. Approximate year range
5. Body type

Return ONLY a JSON object:
{
  "make": "string or null",
  "model": "string or null",
  "variant": "string or null",
  "year": number or null,
  "km": null,
  "price": null,
  "source": null,
  "location": null,
  "confidence": "high/medium/low",
  "notes": "any caveats"
}`;

    const aiResponse = await fetch("https://api.lovable.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        }],
        max_tokens: 500,
        temperature: 0.1,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("[screenshot-identify] AI error:", errorText);
      await supabase.from("scan_guides").update({
        status: "failed",
        error: `AI processing failed: ${aiResponse.status}`,
      }).eq("id", guide_id);
      return new Response(
        JSON.stringify({ error: "AI processing failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResult = await aiResponse.json();
    const content = aiResult.choices?.[0]?.message?.content || "";

    let extracted: Record<string, unknown> = {};
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("[screenshot-identify] JSON parse failed:", e);
    }

    console.log("[screenshot-identify] Extracted:", JSON.stringify(extracted));

    // Update guide with extracted fields
    await supabase.from("scan_guides").update({
      extracted_make: (extracted.make as string) || null,
      extracted_model: (extracted.model as string) || null,
      extracted_variant: (extracted.variant as string) || null,
      extracted_year: (extracted.year as number) || null,
      extracted_km: (extracted.km as number) || null,
      extracted_price: (extracted.price as number) || null,
      extracted_source: (extracted.source as string) || null,
      extracted_fields: extracted,
      status: "confirmed", // Ready for user confirmation
      identity_confidence: (extracted.confidence as string) || "low",
    }).eq("id", guide_id);

    return new Response(
      JSON.stringify({
        success: true,
        guide_id,
        extracted,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[screenshot-identify] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
