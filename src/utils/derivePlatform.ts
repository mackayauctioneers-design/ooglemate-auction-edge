/** Mirrors DB function public.derive_platform_class(make, model) */
export function derivePlatform(make: string, model: string): string {
  const m = (make || "").toUpperCase().trim();
  const mo = (model || "").toUpperCase().trim();

  if (m === "TOYOTA") {
    if (mo.includes("PRADO")) return "PRADO";
    if (mo.includes("LANDCRUISER")) return "LANDCRUISER";
  }
  if (m === "MITSUBISHI" && mo === "OUTLANDER") return "OUTLANDER";
  return `${m}:${mo}`;
}
