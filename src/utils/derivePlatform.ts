/**
 * Frontend re-export of canonical derivePlatform.
 * 
 * The logic is intentionally duplicated here (not imported from edge functions)
 * because frontend cannot import Deno modules. But the implementation MUST
 * stay identical to supabase/functions/_shared/taxonomy/derivePlatform.ts.
 * 
 * DO NOT add platform rules here without also updating the canonical module.
 * DO NOT add identity-defining logic (model maps, variant ladders) here.
 * 
 * This is a DISPLAY helper only. Backend is the source of truth.
 */

export function derivePlatform(make: string, model: string): string {
  const m = (make || "").toUpperCase().trim();
  const mo = (model || "").toUpperCase().trim();

  if (m === "TOYOTA") {
    if (mo.includes("PRADO")) return "PRADO";
    if (mo.includes("LANDCRUISER") || mo.includes("LAND CRUISER")) return "LANDCRUISER";
  }
  if (m === "MITSUBISHI") {
    if (mo.includes("PAJERO SPORT") || mo.includes("PAJERO-SPORT")) return "PAJERO_SPORT";
    if (mo === "OUTLANDER") return "OUTLANDER";
  }
  if (m === "NISSAN") {
    if (mo.includes("PATROL")) return "PATROL";
  }
  return `${m}:${mo}`;
}
