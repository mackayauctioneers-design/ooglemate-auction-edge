/**
 * Banned Substitutions — hard-coded pairs that must NEVER be cross-matched
 * even if the taxonomy looks superficially similar.
 *
 * This is the anti-hallucination backstop for model_family gating.
 * Each entry is symmetric: order does not matter.
 *
 * Match logic uses normalised UPPERCASE comparison of (make, model_token).
 * model_token is matched as substring against the candidate's resolved
 * model name OR family_key, whichever is more specific.
 */

export type BannedPair = {
  /** Description, surfaced as rejection_reason detail */
  why: string;
  /** Make must be one of these (any). null = any make */
  makes: string[] | null;
  /** If intent contains tokenA AND candidate matches tokenB → reject */
  tokenA: string;
  tokenB: string;
};

export const BANNED_SUBSTITUTIONS: BannedPair[] = [
  // Toyota
  { makes: ["TOYOTA"], tokenA: "LANDCRUISER", tokenB: "PRADO", why: "LandCruiser != Prado" },
  { makes: ["TOYOTA"], tokenA: "LC300", tokenB: "LC200", why: "LC300 != LC200 generation" },
  { makes: ["TOYOTA"], tokenA: "LC300", tokenB: "LC70", why: "LC300 != 70 Series" },
  { makes: ["TOYOTA"], tokenA: "LC200", tokenB: "LC70", why: "LC200 != 70 Series" },
  { makes: ["TOYOTA"], tokenA: "PRADO_250", tokenB: "PRADO_150", why: "Prado 250 != Prado 150" },
  { makes: ["TOYOTA"], tokenA: "HILUX", tokenB: "FORTUNER", why: "HiLux != Fortuner" },
  // Subaru
  { makes: ["SUBARU"], tokenA: "WRX", tokenB: "FORESTER", why: "WRX != Forester" },
  { makes: ["SUBARU"], tokenA: "WRX", tokenB: "OUTBACK", why: "WRX != Outback" },
  { makes: ["SUBARU"], tokenA: "WRX", tokenB: "LEVORG", why: "WRX != Levorg (related but distinct)" },
  { makes: ["SUBARU"], tokenA: "FORESTER", tokenB: "CROSSTREK", why: "Forester != Crosstrek" },
  { makes: ["SUBARU"], tokenA: "FORESTER", tokenB: "OUTBACK", why: "Forester != Outback" },
  // VW
  { makes: ["VOLKSWAGEN"], tokenA: "TIGUAN", tokenB: "TOUAREG", why: "Tiguan != Touareg" },
  { makes: ["VOLKSWAGEN"], tokenA: "GOLF", tokenB: "POLO", why: "Golf != Polo" },
  // Ford
  { makes: ["FORD"], tokenA: "RANGER", tokenB: "EVEREST", why: "Ranger != Everest (shared platform, different vehicle)" },
  { makes: ["FORD"], tokenA: "RAPTOR", tokenB: "WILDTRAK", why: "Raptor != Wildtrak trim" },
  // Isuzu
  { makes: ["ISUZU"], tokenA: "D-MAX", tokenB: "MU-X", why: "D-Max != MU-X" },
  { makes: ["ISUZU"], tokenA: "DMAX", tokenB: "MUX", why: "D-Max != MU-X" },
  // Nissan
  { makes: ["NISSAN"], tokenA: "PATROL", tokenB: "PATHFINDER", why: "Patrol != Pathfinder" },
  { makes: ["NISSAN"], tokenA: "NAVARA", tokenB: "PATROL", why: "Navara != Patrol" },
  // Chev / GMC
  { makes: ["CHEVROLET", "GMC"], tokenA: "SILVERADO", tokenB: "SIERRA", why: "Silverado != Sierra (rebadge, treat distinct unless explicit)" },
  // BMW generations
  { makes: ["BMW"], tokenA: "F30", tokenB: "G20", why: "F30 != G20 (3-series generations)" },
  { makes: ["BMW"], tokenA: "E90", tokenB: "F30", why: "E90 != F30" },
];

const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Returns the matched banned pair if intent and candidate trigger one, else null.
 */
export function checkBannedSubstitution(
  make: string | null,
  intentModelOrSeries: string | null,
  candidateModelOrSeries: string | null,
): BannedPair | null {
  if (!intentModelOrSeries || !candidateModelOrSeries) return null;
  const m = (make ?? "").toUpperCase();
  const i = norm(intentModelOrSeries);
  const c = norm(candidateModelOrSeries);
  if (!i || !c || i === c) return null;

  for (const pair of BANNED_SUBSTITUTIONS) {
    if (pair.makes && !pair.makes.includes(m)) continue;
    const a = norm(pair.tokenA);
    const b = norm(pair.tokenB);
    const intentHasA = i.includes(a);
    const intentHasB = i.includes(b);
    const candHasA = c.includes(a);
    const candHasB = c.includes(b);
    if ((intentHasA && candHasB && !candHasA) || (intentHasB && candHasA && !candHasB)) {
      return pair;
    }
  }
  return null;
}
