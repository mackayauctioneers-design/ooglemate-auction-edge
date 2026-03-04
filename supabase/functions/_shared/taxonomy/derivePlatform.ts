/**
 * CANONICAL PLATFORM CLASSIFIER — Single source of truth
 * 
 * Mirrors DB function public.derive_platform_class(make, model).
 * ALL platform classification MUST use this module.
 * 
 * Frontend and edge functions import from here (or from the 
 * frontend re-export at src/utils/derivePlatform.ts).
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
 * GENERATION / SERIES EXTRACTOR — Sub-platform classifier
 *
 * Extracts the generation or series number from model text.
 * Used by VALO to prevent cross-generation contamination
 * (e.g. LC300 vs LC70 vs LC200).
 *
 * Returns null if no generation can be determined.
 */
export function extractSeries(make: string, model: string): string | null {
  const m = (make || "").toUpperCase().trim();
  const mo = (model || "").toUpperCase().trim();

  if (m === "TOYOTA") {
    // LandCruiser generations
    if (mo.includes("LANDCRUISER") || mo.includes("LAND CRUISER")) {
      if (mo.includes("300")) return "LC300";
      if (mo.includes("200")) return "LC200";
      if (mo.includes("79") || mo.includes("76") || mo.includes("78") || mo.includes("70")) return "LC70";
      return null; // LandCruiser but unknown generation
    }
    // Prado generations
    if (mo.includes("PRADO")) {
      if (mo.includes("250")) return "PRADO_250";
      if (mo.includes("150")) return "PRADO_150";
      return null;
    }
    // Hilux generations
    if (mo.includes("HILUX")) {
      if (mo.includes("GUN") || mo.includes("N80")) return "HILUX_N80";
      if (mo.includes("REVO")) return "HILUX_REVO";
      return null;
    }
  }

  if (m === "FORD") {
    if (mo.includes("RANGER")) {
      if (mo.includes("NEXT GEN") || mo.includes("NEXTGEN") || mo.includes("V6")) return "RANGER_PY";
      return null;
    }
  }

  if (m === "ISUZU") {
    if (mo.includes("D-MAX") || mo.includes("DMAX")) {
      if (mo.includes("RG")) return "DMAX_RG";
      return null;
    }
  }

  if (m === "NISSAN") {
    if (mo.includes("PATROL")) {
      if (mo.includes("Y62")) return "PATROL_Y62";
      if (mo.includes("Y61") || mo.includes("GU")) return "PATROL_Y61";
      return null;
    }
  }

  return null;
}

/**
 * CANONICAL BADGE EXTRACTOR — Single source of truth
 * 
 * Extracts the highest-priority variant badge from free text.
 * Used by scoring, fingerprinting, and display.
 * 
 * Rules:
 * - Longer badges checked first (prevents "SR" matching before "SR5")
 * - Short badges use word-boundary regex (prevents "GX" matching "GXL")
 */
export function extractBadge(text: string | null): string {
  if (!text) return "";
  const d = text.toUpperCase();

  // Long badges — substring match is safe (no collision risk)
  const badges = [
    "EXCEED TOURER", "EXCEED", "X-TERRAIN", "XTERRAIN", "PRO-4X", "PRO4X",
    "GLX-R", "GLX+", "GLX PLUS", "SR5", "ROGUE", "RUGGED X", "RUGGED-X", "RUGGED",
    "RAPTOR", "WILDTRAK", "KAKADU", "SAHARA", "ASPIRE", "TITANIUM", "PLATINUM",
    "GXL", "VX", "GX", "XLT", "XLS", "LS-U", "LSU", "LS-M", "LSM", "LS-T", "LST",
    "ST-X", "STX", "ST-L", "STL", "GLS", "GR", "N-TREK", "COMMUTER", "SLWB", "LWB",
    "WORKMATE", "AMBIENTE", "TREND",
    "ASCENT SPORT", "ASCENT", "MAXX SPORT", "MAXX",
    "AKARI", "GT-LINE", "SPORT", "TOURING",
  ];

  // Short badges — must use word boundary to prevent substring collisions
  const shortBadges = [
    "SR", "XL", "LS", "ES", "SL", "ST", "TI", "LT", "LTZ", "Z71", "SS", "SSV", "SV6", "SX", "XT", "RX",
  ];

  for (const b of badges) {
    if (d.includes(b)) return b;
  }
  for (const b of shortBadges) {
    if (new RegExp(`\\b${b}\\b`).test(d)) return b;
  }
  return "";
}
