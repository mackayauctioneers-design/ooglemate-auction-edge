import { supabase } from "@/integrations/supabase/client";

export interface OogleBotFilters {
  make: string | null;
  model: string | null;
  badge: string | null;
  year_min: number | null;
  year_max: number | null;
  max_km: number | null;
  price_max: number | null;
}

export interface OogleBotResult {
  listing_id: string;
  make: string;
  model: string;
  variant: string | null;
  year: number;
  km: number | null;
  price: number | null;
  effective_cost: number | null;
  score: number;
  match_reason: string[];
  source: string;
  source_class: string;
  location: string | null;
  state: string | null;
  listing_url: string | null;
  auction_house: string | null;
  drivetrain: string | null;
  fuel: string | null;
  transmission: string | null;
  fingerprint: string | null;
  fingerprint_confidence: number;
  lifecycle_state: string;
  days_listed: number | null;
  is_dealer_grade: boolean | null;
}

export interface OogleBotResponse {
  status: "ok" | "error";
  filters?: OogleBotFilters;
  count?: number;
  results?: OogleBotResult[];
  error?: string;
}

/** Call the ooglebot intent parser → structured search pipeline */
export async function searchOogleBot(message: string): Promise<OogleBotResponse> {
  const { data, error } = await supabase.functions.invoke("ooglebot", {
    body: { message },
  });

  if (error) {
    throw new Error(error.message || "Failed to call OogleBot");
  }

  if (data?.status === "error") {
    throw new Error(data.error || "OogleBot search failed");
  }

  return data as OogleBotResponse;
}

/** Call ooglebot-search directly with structured filters (bypass NLP) */
export async function searchOogleBotDirect(filters: {
  make: string;
  model: string;
  badge?: string | null;
  year_min?: number | null;
  year_max?: number | null;
  max_km?: number | null;
  price_max?: number | null;
  limit?: number;
}): Promise<OogleBotResponse> {
  const { data, error } = await supabase.functions.invoke("ooglebot-search", {
    body: filters,
  });

  if (error) {
    throw new Error(error.message || "Failed to call OogleBot Search");
  }

  if (data?.status === "error") {
    throw new Error(data.error || "Search failed");
  }

  return {
    status: "ok",
    filters: {
      make: filters.make,
      model: filters.model,
      badge: filters.badge ?? null,
      year_min: filters.year_min ?? null,
      year_max: filters.year_max ?? null,
      max_km: filters.max_km ?? null,
      price_max: filters.price_max ?? null,
    },
    count: data.count,
    results: data.results,
  };
}

// ── Outward Search types ──
export interface OutwardSearchResult {
  source: string;
  title: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  location: string | null;
  variant: string | null;
  url: string;
  score: number;
}

export interface OutwardSearchResponse {
  status: "ok" | "error";
  gated?: boolean;
  reason?: string;
  intent?: {
    make: string | null;
    model_keywords: string[];
    year: number | null;
    max_km: number | null;
    price_max: number | null;
  };
  results?: OutwardSearchResult[];
  total_searched?: number;
  total_filtered?: number;
  duration_ms?: number;
  error?: string;
  message?: string;
}

/** Call run-outward-search: searches whitelisted external domains with demand gating */
export async function runOutwardSearch(
  instruction: string,
  internalCount?: number,
  urgency?: string,
): Promise<OutwardSearchResponse> {
  const { data, error } = await supabase.functions.invoke("run-outward-search", {
    body: { instruction, internal_count: internalCount ?? 0, urgency: urgency ?? "normal" },
  });

  if (error) {
    throw new Error(error.message || "Failed to call outward search");
  }

  if (data?.status === "error") {
    throw new Error(data.error || "Outward search failed");
  }

  return data as OutwardSearchResponse;
}
