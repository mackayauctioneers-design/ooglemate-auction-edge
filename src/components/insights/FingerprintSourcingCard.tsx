import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Repeat, Eye, Target, Clock, DollarSign, BarChart3, AlertTriangle, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";

interface Props {
  accountId: string | null;
}

interface TargetCandidate {
  make: string;
  model: string;
  variant: string | null;
  transmission: string | null;
  fuel_type: string | null;
  drive_type: string | null;
  body_type: string | null;
  sales_count: number;
  median_profit: number | null;
  median_profit_pct: number | null;
  median_sale_price: number | null;
  median_days_to_clear: number | null;
  target_score: number;
  fingerprint_type: string;
  confidence_level: string;
  spec_completeness: number | null;
}

function buildDnaLabel(c: TargetCandidate): string {
  const parts = [c.make, c.model];
  if (c.variant) parts.push(c.variant);
  return parts.join(" ");
}

function buildSpecLine(c: TargetCandidate): string {
  const specs: string[] = [];
  if (c.drive_type) specs.push(c.drive_type);
  if (c.fuel_type) specs.push(c.fuel_type);
  if (c.transmission) specs.push(c.transmission);
  if (c.body_type) specs.push(c.body_type);
  return specs.join(" · ");
}

function confidenceVariant(level: string): string {
  switch (level?.toUpperCase()) {
    case "HIGH": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/25";
    case "MEDIUM": return "bg-amber-500/15 text-amber-400 border-amber-500/25";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

/** Compute spec completeness from raw fields (fallback when DB value is 0/null) */
function computeSpecCompleteness(c: TargetCandidate): number {
  // If DB has a positive value, use it; otherwise derive from fields
  if (c.spec_completeness != null && c.spec_completeness > 0) return c.spec_completeness;
  let count = 0;
  if (c.variant) count++;
  if (c.body_type) count++;
  if (c.fuel_type) count++;
  if (c.transmission) count++;
  if (c.drive_type) count++;
  return count;
}

/** Is this shape fully spec'd enough to claim "identical"? */
function isFullySpecd(c: TargetCandidate): boolean {
  return computeSpecCompleteness(c) >= 3;
}

/** Profit plausibility: flag if median_profit > 30% of median_sale_price */
function isProfitSuspicious(c: TargetCandidate): boolean {
  if (c.median_profit == null || c.median_sale_price == null || c.median_sale_price <= 0) return false;
  return c.median_profit > c.median_sale_price * 0.3;
}

/**
 * Client-side confidence hardening.
 * Applies spec_completeness and profit plausibility rules to override
 * stale DB confidence values. This is the single source of truth for display.
 *
 * Rules:
 * - ≥5 sales AND spec ≥3 → HIGH
 * - 3-4 sales OR spec <3 → MEDIUM (max)
 * - 1-2 sales → LOW
 * - Profit suspicious → downgrade by one level, never HIGH
 */
function effectiveConfidence(c: TargetCandidate): "HIGH" | "MEDIUM" | "LOW" {
  const spec = computeSpecCompleteness(c);
  const suspicious = isProfitSuspicious(c);

  let level: "HIGH" | "MEDIUM" | "LOW";

  if (c.sales_count <= 2) {
    level = "LOW";
  } else if (c.sales_count >= 5 && spec >= 3) {
    level = "HIGH";
  } else {
    level = "MEDIUM";
  }

  // Profit plausibility downgrade
  if (suspicious) {
    if (level === "HIGH") level = "MEDIUM";
    else if (level === "MEDIUM") level = "LOW";
  }

  return level;
}

function salesLabel(c: TargetCandidate): string {
  const count = c.sales_count;
  const word = count === 1 ? "sale" : "sales";
  if (isFullySpecd(c)) {
    return `${count} identical ${word}`;
  }
  return `${count} similar ${word} (mixed specs)`;
}

function profitDisplay(c: TargetCandidate): string {
  if (c.median_profit == null) return "Unavailable (data incomplete)";
  return `$${Math.abs(c.median_profit).toLocaleString()}`;
}

function clearanceDisplay(c: TargetCandidate): string {
  if (c.median_days_to_clear == null) return "Unavailable (data incomplete)";
  return `${c.median_days_to_clear} days`;
}

export function FingerprintSourcingCard({ accountId }: Props) {
  const { user } = useAuth();
  const [savedShapes, setSavedShapes] = useState<Set<string>>(new Set());

  const handleSearch = useCallback((c: TargetCandidate) => {
    const q = encodeURIComponent(`${c.make} ${c.model} ${c.variant || ""}`.trim());
    window.open(`https://www.pickles.com.au/cars/search?q=${q}`, "_blank");
  }, []);

  const handleWatch = useCallback(async (c: TargetCandidate) => {
    if (!user || !accountId) {
      toast.error("Please sign in to save to watchlist");
      return;
    }
    const key = `${c.make}-${c.model}-${c.variant || ""}`;
    const { error } = await supabase.from("sourcing_watchlist").insert({
      user_id: user.id,
      account_id: accountId,
      make: c.make,
      model: c.model,
      variant: c.variant || null,
      drivetrain: c.drive_type || null,
      fuel_type: c.fuel_type || null,
      transmission: c.transmission || null,
      confidence_level: effectiveConfidence(c),
      watch_type: c.fingerprint_type === "core" ? "hunt" : "watch",
      originating_insight: `Fingerprint sourcing: ${buildDnaLabel(c)} — ${salesLabel(c)}, median profit ${profitDisplay(c)}`,
    });
    if (error) {
      console.error("Save error:", error);
      toast.error("Failed to save");
    } else {
      setSavedShapes((prev) => new Set([...prev, key]));
      toast.success(c.fingerprint_type === "core" ? "Added to hunt list" : "Added to watchlist");
    }
  }, [user, accountId]);
  const { data, isLoading } = useQuery({
    queryKey: ["fingerprint-sourcing", accountId],
    queryFn: async () => {
      if (!accountId) return [];
      const { data, error } = await supabase
        .from("sales_target_candidates")
        .select("make, model, variant, transmission, fuel_type, drive_type, body_type, sales_count, median_profit, median_profit_pct, median_sale_price, median_days_to_clear, target_score, fingerprint_type, confidence_level, spec_completeness")
        .eq("account_id", accountId)
        .in("status", ["candidate", "active"])
        .order("target_score", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data || []) as TargetCandidate[];
    },
    enabled: !!accountId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            What You Should Be Buying Again
          </CardTitle>
        </CardHeader>
        <CardContent className="h-48 flex items-center justify-center">
          <p className="text-muted-foreground">Loading sourcing instructions…</p>
        </CardContent>
      </Card>
    );
  }

  if (!data?.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            What You Should Be Buying Again
          </CardTitle>
        </CardHeader>
        <CardContent className="py-12 text-center text-muted-foreground">
          Sourcing instructions will appear after sales data has been processed into target candidates.
        </CardContent>
      </Card>
    );
  }

  const coreItems = data.filter(
    (c) => c.fingerprint_type === "core" && c.sales_count >= 3 && ["MEDIUM", "HIGH"].includes(c.confidence_level?.toUpperCase())
  );
  const outcomeItems = data.filter(
    (c) => c.fingerprint_type === "outcome" && c.sales_count <= 2
  );

  return (
    <div className="space-y-6">
      {/* ── Actively Hunt — Repeatable Winners ── */}
      {coreItems.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Repeat className="h-5 w-5 text-primary" />
              Actively Hunt — Repeatable Winners
            </CardTitle>
            <CardDescription>
              These vehicle shapes have repeated, profitable outcomes. Each is a sourcing instruction you can act on immediately.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {coreItems.map((c, i) => (
              <SourcingRow key={`core-${i}`} candidate={c} onSearch={handleSearch} onWatch={handleWatch} isSaved={savedShapes.has(`${c.make}-${c.model}-${c.variant || ""}`)} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Watch & Re-Test — Profitable Outcomes ── */}
      {outcomeItems.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="h-5 w-5 text-accent-foreground" />
              Watch &amp; Re-Test — Profitable Outcomes
            </CardTitle>
            <CardDescription>
              Single profitable outcomes are signals, not noise. These shapes delivered strong returns and are worth watching for repeats.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {outcomeItems.map((c, i) => (
              <SourcingRow key={`outcome-${i}`} candidate={c} isOutcome onSearch={handleSearch} onWatch={handleWatch} isSaved={savedShapes.has(`${c.make}-${c.model}-${c.variant || ""}`)} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SourcingRow({ candidate: c, isOutcome, onSearch, onWatch, isSaved }: { candidate: TargetCandidate; isOutcome?: boolean; onSearch?: (c: TargetCandidate) => void; onWatch?: (c: TargetCandidate) => void; isSaved?: boolean }) {
  const specLine = buildSpecLine(c);
  const confidence = effectiveConfidence(c);
  const suspicious = isProfitSuspicious(c);

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
      {/* Title + confidence badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="font-semibold text-sm">{buildDnaLabel(c)}</p>
          {specLine && (
            <p className="text-xs text-muted-foreground">{specLine}</p>
          )}
        </div>
        <Badge variant="outline" className={`text-xs shrink-0 ${confidenceVariant(confidence)}`}>
          {confidence}
        </Badge>
      </div>

      {/* Metrics row */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <BarChart3 className="h-3 w-3" />
          {salesLabel(c)}
        </span>
        <span className="flex items-center gap-1">
          <DollarSign className="h-3 w-3" />
          {c.sales_count === 1 ? "Profit" : "Median profit"}: {profitDisplay(c)}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Clearance: {clearanceDisplay(c)}
        </span>
      </div>

      {/* Profit plausibility warning */}
      {suspicious && (
        <p className="text-xs flex items-center gap-1 text-amber-400/80">
          <AlertTriangle className="h-3 w-3" />
          Derived or low-confidence profit — verify source
        </p>
      )}

      {/* Incomplete spec warning for high-count shapes */}
      {!isFullySpecd(c) && c.sales_count >= 5 && (
        <p className="text-xs text-muted-foreground/70 italic">
          Spec data incomplete — count includes similar vehicles across mixed trims/specs
        </p>
      )}

      {/* Outcome context note */}
      {isOutcome && (
        <p className="text-xs text-muted-foreground italic">
          {c.sales_count === 1
            ? "Strong outcome, low repeatability so far — worth re-testing"
            : "Strong outcome from limited sales — building evidence"}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        {onSearch && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => onSearch(c)}>
            <Search className="h-3 w-3" />
            Search current listings
          </Button>
        )}
        {onWatch && !isSaved && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => onWatch(c)}>
            <Star className="h-3 w-3" />
            {isOutcome ? "Watch for similar vehicles" : "Add to sourcing list"}
          </Button>
        )}
        {isSaved && (
          <span className="text-xs text-primary">✓ Saved to watchlist</span>
        )}
      </div>
    </div>
  );
}
