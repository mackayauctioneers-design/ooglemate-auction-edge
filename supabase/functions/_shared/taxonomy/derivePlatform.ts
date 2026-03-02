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
