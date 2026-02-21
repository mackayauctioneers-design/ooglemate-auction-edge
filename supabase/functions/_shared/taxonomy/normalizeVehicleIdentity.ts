/**
 * CANONICAL VEHICLE IDENTITY NORMALIZER — v1.0-hybrid
 * 
 * Single source of truth for make/model/variant resolution.
 * All ingestion paths MUST use this module.
 * 
 * Uses: taxonomy_models + taxonomy_variant_rank tables (DB-driven)
 * Falls back to hardcoded KNOWN_MAKES for make detection only.
 */

export type NormalizeInput = {
  dealerId?: string;
  source?: string;
  url?: string;
  title?: string;
  makeRaw?: string | null;
  modelRaw?: string | null;
  variantRaw?: string | null;
  year?: number | null;
  km?: number | null;
  bodyText?: string | null;
};

export type NormalizeResult = {
  make: string | null;
  model: string | null;
  variant: string | null;
  confidence: number;
  explain: string[];
  normalizerVersion: string;
  familyKey?: string | null;
};

export type TaxonomyDeps = {
  getCanonicalModels: (make: string) => Promise<Array<{ canonical_model: string; family_key: string; aliases: string[] }>>;
  getVariantRanks: (make: string, model?: string | null) => Promise<Array<{ canonical_variant: string; aliases: string[]; rank: number }>>;
  getDealerTruth: (dealerId: string, make: string, familyKey: string) => Promise<Array<{ model: string; variant: string | null; count_sold: number }>>;
};

const NORMALIZER_VERSION = "v1.0-hybrid";

// ─── String helpers ──────────────────────────────────────────────────────────

const norm = (s?: string | null): string =>
  (s ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normSlug = (s?: string | null): string => norm(s).replace(/\s+/g, "-");

const titleCase = (s: string): string =>
  s.split(" ").map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

const clampInt = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(n)));

// ─── Make detection (hardcoded — these rarely change) ────────────────────────

const KNOWN_MAKES = [
  "toyota", "ford", "mazda", "mitsubishi", "isuzu", "nissan", "hyundai", "kia",
  "volkswagen", "subaru", "honda", "bmw", "mercedes", "audi", "lexus", "suzuki",
  "tesla", "ldv", "ram", "chevrolet", "chrysler", "dodge", "jeep",
  "land rover", "landrover", "porsche", "volvo", "peugeot", "renault", "skoda",
  "mg", "great wall", "haval", "gwm",
];

function pickMake(makeRaw: string | null | undefined, url: string, title: string, text: string): string | null {
  const r = norm(makeRaw);
  if (r && KNOWN_MAKES.some(m => r.includes(m.replace(/\s+/g, "")) || r.includes(m))) {
    // Find the actual make match from the raw input
    for (const m of KNOWN_MAKES) {
      if (r.includes(m) || r.includes(m.replace(/\s+/g, ""))) return m;
    }
  }
  if (r && r.length > 1) return r; // trust raw if provided even if not in list

  const blob = `${url} ${title} ${text}`.toLowerCase();
  for (const m of KNOWN_MAKES) {
    const ms = m.replace(/\s+/g, "");
    if (blob.includes(m) || blob.includes(ms)) return m;
  }
  return null;
}

// ─── Model scoring ───────────────────────────────────────────────────────────

type ScoredModel = {
  canonical_model: string;
  family_key: string;
  aliases: string[];
  score: number;
  confidence: number;
  reasons: string[];
  ambiguousFamily: boolean;
};

const AMBIGUOUS_FAMILIES = [
  "LC_PRADO", "LC_200_300", "RANGER_EVEREST", "HILUX_FORTUNER", "D_MAX_MU_X",
];

function scoreModelCandidates(
  models: Array<{ canonical_model: string; family_key: string; aliases: string[] }>,
  ctx: { url: string; title: string; text: string; modelRaw?: string | null },
): ScoredModel[] {
  const blob = norm(`${ctx.url} ${ctx.title} ${ctx.text} ${ctx.modelRaw ?? ""}`);

  const scored: ScoredModel[] = models.map(m => {
    let score = 0;
    const reasons: string[] = [];
    const canon = norm(m.canonical_model);

    // Direct hit in text blob
    if (blob.includes(canon)) {
      score += 60;
      reasons.push("RULE_MODEL_CANON_HIT");
    }

    // Alias hits
    for (const a of (m.aliases ?? [])) {
      const aa = norm(a);
      if (!aa) continue;
      if (blob.includes(aa)) {
        score += 45;
        reasons.push("RULE_MODEL_ALIAS_HIT");
        break;
      }
    }

    // URL slug match
    if (ctx.url && normSlug(ctx.url).includes(normSlug(m.canonical_model))) {
      score += 50;
      reasons.push("RULE_MODEL_URL_SLUG_HIT");
    }

    const ambiguousFamily = AMBIGUOUS_FAMILIES.includes(m.family_key);
    const confidence = Math.min(95, score);

    return { ...m, score, confidence, reasons, ambiguousFamily };
  });

  // Sort by score descending, prefer longer canonical names (prevents truncation)
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tie-break: longer canonical model wins (LandCruiser Prado > LandCruiser)
      return b.canonical_model.length - a.canonical_model.length;
    });
}

// ─── Variant picking ─────────────────────────────────────────────────────────

function pickVariant(
  ranks: Array<{ canonical_variant: string; aliases: string[]; rank: number }>,
  variantRaw: string | null | undefined,
  title: string,
  text: string,
): string | null {
  const blob = norm(`${variantRaw ?? ""} ${title} ${text}`);

  const hits = ranks
    .map(v => {
      const canon = norm(v.canonical_variant);
      let hit = blob.includes(canon);
      if (!hit) {
        for (const a of (v.aliases ?? [])) {
          const aa = norm(a);
          if (aa && blob.includes(aa)) { hit = true; break; }
        }
      }
      return hit ? v : null;
    })
    .filter(Boolean) as Array<{ canonical_variant: string; aliases: string[]; rank: number }>;

  if (hits.length === 0) return null;
  hits.sort((a, b) => b.rank - a.rank);
  return hits[0].canonical_variant;
}

// ─── Sales truth override ────────────────────────────────────────────────────

function selectTruthOverride(
  truth: Array<{ model: string; variant: string | null; count_sold: number }>,
  candidates: ScoredModel[],
  _ctx: { year: number | null; km: number | null },
) {
  if (!truth?.length) return null;

  const candSet = new Set(candidates.map(c => c.canonical_model));
  const eligible = truth.filter(t => candSet.has(t.model));
  if (!eligible.length) return null;

  eligible.sort((a, b) => b.count_sold - a.count_sold);
  const best = eligible[0];

  const truthCandidate = candidates.find(c => c.canonical_model === best.model);
  const overrideScore = (truthCandidate?.score ?? 0) + Math.min(40, best.count_sold * 10);

  return { ...best, overrideScore, baselineScore: candidates[0]?.score ?? 0 };
}

// ─── MAIN NORMALIZER ────────────────────────────────────────────────────────

export async function normalizeVehicleIdentity(
  deps: TaxonomyDeps,
  input: NormalizeInput,
): Promise<NormalizeResult> {
  const explain: string[] = [];

  const url = input.url ?? "";
  const title = input.title ?? "";
  const text = (input.bodyText ?? "").slice(0, 8000);

  // 1) Make detection
  const makeGuess = pickMake(input.makeRaw, url, title, text);
  if (!makeGuess) {
    return { make: null, model: null, variant: null, confidence: 0, explain: ["NO_MAKE"], normalizerVersion: NORMALIZER_VERSION };
  }

  const make = titleCase(makeGuess);
  explain.push("MAKE_DETECTED");

  // 2) Model candidates from taxonomy DB
  const makeModels = await deps.getCanonicalModels(make);

  if (makeModels.length === 0) {
    // No taxonomy entries — fall back to raw model if provided
    const rawModel = input.modelRaw ? titleCase(norm(input.modelRaw)) : null;
    return {
      make,
      model: rawModel,
      variant: input.variantRaw || null,
      confidence: rawModel ? 30 : 10,
      explain: [...explain, "NO_TAXONOMY_ENTRIES", rawModel ? "RAW_MODEL_FALLBACK" : "NO_MODEL"],
      normalizerVersion: NORMALIZER_VERSION,
    };
  }

  const candidates = scoreModelCandidates(makeModels, { url, title, text, modelRaw: input.modelRaw });

  if (candidates.length === 0) {
    const rawModel = input.modelRaw ? titleCase(norm(input.modelRaw)) : null;
    return {
      make,
      model: rawModel,
      variant: input.variantRaw || null,
      confidence: rawModel ? 25 : 10,
      explain: [...explain, "NO_MODEL_CANDIDATES", rawModel ? "RAW_MODEL_FALLBACK" : "NO_MODEL"],
      normalizerVersion: NORMALIZER_VERSION,
    };
  }

  const baseline = candidates[0];
  let chosen = baseline;
  explain.push(...baseline.reasons);

  // 3) Variant extraction
  const variantRanks = await deps.getVariantRanks(make, baseline.canonical_model);
  const variant = pickVariant(variantRanks, input.variantRaw, title, text);
  if (variant) explain.push("VARIANT_DETECTED");

  // 4) Sales-truth assist (dealer-first) — only override when strong
  if (input.dealerId && (baseline.confidence < 80 || baseline.ambiguousFamily)) {
    const truth = await deps.getDealerTruth(input.dealerId, make, baseline.family_key);
    const bestTruth = selectTruthOverride(truth, candidates, { year: input.year ?? null, km: input.km ?? null });

    if (bestTruth && bestTruth.count_sold >= 2 && bestTruth.overrideScore - baseline.score >= 15) {
      const overrideCandidate = candidates.find(c => c.canonical_model === bestTruth.model);
      if (overrideCandidate) {
        chosen = overrideCandidate;
        explain.push("ASSIST_OVERRIDE_DEALER_TRUTH");
      }
    } else {
      explain.push("ASSIST_NO_OVERRIDE");
    }
  }

  // 5) Confidence
  const confidence = clampInt(chosen.confidence + (variant ? 5 : 0), 0, 100);

  return {
    make,
    model: chosen.canonical_model,
    variant: variant ?? null,
    confidence,
    explain,
    normalizerVersion: NORMALIZER_VERSION,
    familyKey: chosen.family_key,
  };
}
