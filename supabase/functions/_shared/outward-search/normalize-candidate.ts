/**
 * Candidate Normalizer — converts ANY raw source row (internal, shadow,
 * outward) into the canonical `NormalizedCandidate` shape used by gates.
 *
 * Uses `normalizeVehicleIdentity` for make/model/variant resolution when raw
 * fields are messy. Body & series come from taxonomy helpers and the raw text.
 *
 * AI is NOT called here. AI extraction lives in gemini-extract.ts and is only
 * invoked by the orchestrator when raw fields are missing.
 */

import { extractSeries } from "../taxonomy/derivePlatform.ts";
import { normalizeVehicleIdentity, type TaxonomyDeps } from "../taxonomy/normalizeVehicleIdentity.ts";
import type { NormalizedCandidate } from "./gates.ts";

export interface RawSourceRow {
  source: string;
  layer: "internal" | "shadow" | "outward";
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  body_type?: string | null;
  year?: number | null;
  km?: number | null;
  price?: number | null;
  url?: string | null;
  title?: string | null;
  description?: string | null;
  [k: string]: unknown;
}

const BODY_GUESS: Array<[RegExp, string]> = [
  [/sportswagon|sport\s*wagon|\bwagon\b/i, "WAGON"],
  [/\bsedan\b/i, "SEDAN"],
  [/\butility|\bute\b|\bdual\s*cab|\bsingle\s*cab|\bcab\s*chassis/i, "UTE"],
  [/\bsuv\b/i, "SUV"],
  [/\bhatch(?:back)?\b/i, "HATCH"],
  [/\bcoupe\b/i, "COUPE"],
];

function guessBody(text: string): string | null {
  for (const [re, label] of BODY_GUESS) if (re.test(text)) return label;
  return null;
}

export async function normalizeCandidate(
  raw: RawSourceRow,
  taxonomyDeps: TaxonomyDeps,
): Promise<NormalizedCandidate> {
  const text = `${raw.title ?? ""} ${raw.description ?? ""} ${raw.url ?? ""}`;
  const idResult = await normalizeVehicleIdentity(taxonomyDeps, {
    makeRaw: raw.make ?? null,
    modelRaw: raw.model ?? null,
    variantRaw: raw.variant ?? null,
    title: raw.title ?? null,
    url: raw.url ?? "",
    bodyText: raw.description ?? null,
    year: raw.year ?? null,
    km: raw.km ?? null,
  });

  const make = idResult.make ? idResult.make.toUpperCase() : (raw.make ?? null);
  const model = idResult.model ? idResult.model.toUpperCase() : (raw.model ?? null);
  const series = make && model ? extractSeries(make, `${model} ${text}`) : null;
  const body = raw.body_type ?? guessBody(text);

  return {
    make,
    model,
    variant: idResult.variant ?? raw.variant ?? null,
    series,
    body_type: body,
    year: raw.year ?? null,
    km: raw.km ?? null,
    price: raw.price ?? null,
    source: raw.source,
    layer: raw.layer,
    url: raw.url ?? null,
    identity_confidence: idResult.confidence,
    raw,
  };
}
