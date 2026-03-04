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

/**
 * Frontend mirror of extractSeries from backend.
 * Display-only — for showing generation labels in UI.
 */
export function extractSeries(make: string, model: string): string | null {
  const m = (make || "").toUpperCase().trim();
  const mo = (model || "").toUpperCase().trim();

  if (m === "TOYOTA") {
    if (mo.includes("LANDCRUISER") || mo.includes("LAND CRUISER")) {
      if (mo.includes("300")) return "LC300";
      if (mo.includes("200")) return "LC200";
      if (mo.includes("79") || mo.includes("76") || mo.includes("78") || mo.includes("70")) return "LC70";
      return null;
    }
    if (mo.includes("PRADO")) {
      if (mo.includes("250")) return "PRADO_250";
      if (mo.includes("150")) return "PRADO_150";
      return null;
    }
  }
  if (m === "FORD") {
    if (mo.includes("RANGER")) {
      if (mo.includes("NEXT GEN") || mo.includes("NEXTGEN") || mo.includes("V6")) return "RANGER_PY";
      return null;
    }
  }
  return null;
}
