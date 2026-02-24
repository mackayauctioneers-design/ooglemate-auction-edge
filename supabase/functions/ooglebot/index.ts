const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rawKey = Deno.env.get("OPENCLAW_API_KEY") || "";
    const apiKey = rawKey.replace(/[^\x20-\x7E]/g, "").trim();
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "OPENCLAW_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { message, agent = "main" } = await req.json();

    if (!message) {
      return new Response(
        JSON.stringify({ success: false, error: "message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("OogleBot search:", message, "agent:", agent);

    const headers: Record<string, string> = {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
    };
    if (agent) {
      headers["x-openclaw-agent-id"] = String(agent).trim();
    }

    const response = await fetch("https://seminars-somerset-scale-missile.trycloudflare.com/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "openclaw",
        messages: [{ role: "user", content: message }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OogleBot API error:", response.status, errText);
      return new Response(
        JSON.stringify({ success: false, error: `API error: ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || data.reply || data.message || JSON.stringify(data);

    return new Response(
      JSON.stringify({ success: true, reply }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("OogleBot proxy error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
