// TEMP diagnostic — returns hash prefixes of stored tokens. Delete after use.
Deno.serve(async () => {
  const enc = new TextEncoder();
  async function h(s: string) {
    const b = await crypto.subtle.digest("SHA-256", enc.encode(s ?? ""));
    return Array.from(new Uint8Array(b)).slice(0, 8).map(x => x.toString(16).padStart(2, "0")).join("");
  }
  const r = Deno.env.get("OPENCLAW_READ_TOKEN") ?? "";
  const w = Deno.env.get("OPENCLAW_WRITE_TOKEN") ?? "";
  return new Response(JSON.stringify({
    read_len: r.length, write_len: w.length,
    read_hash8: await h(r), write_hash8: await h(w),
  }), { headers: { "Content-Type": "application/json" } });
});
