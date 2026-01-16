import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Info,
  ChevronDown
} from "lucide-react";
import { HuntAlertPayload, SaleHunt } from "@/types/hunts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface WhyMatchedDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: HuntAlertPayload;
  alertType: "BUY" | "WATCH";
  hunt?: SaleHunt | null;
}

function MatchCheck({ 
  label, 
  status, 
  detail 
}: { 
  label: string; 
  status: "pass" | "warn" | "fail" | "unknown"; 
  detail?: string;
}) {
  const icons = {
    pass: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
    warn: <AlertTriangle className="h-4 w-4 text-amber-500" />,
    fail: <XCircle className="h-4 w-4 text-destructive" />,
    unknown: <Info className="h-4 w-4 text-muted-foreground" />,
  };

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        {icons[status]}
        <span className="text-sm">{label}</span>
      </div>
      {detail && (
        <span className="text-sm text-muted-foreground">{detail}</span>
      )}
    </div>
  );
}

export function WhyMatchedDrawer({ 
  open, 
  onOpenChange, 
  payload, 
  alertType,
  hunt
}: WhyMatchedDrawerProps) {
  const [showRaw, setShowRaw] = useState(false);
  const p = payload;

  // Determine match quality for each criterion
  const yearStatus = p.year ? "pass" : "unknown";
  const makeModelStatus = p.make && p.model ? "pass" : "unknown";
  const variantStatus = p.variant ? "pass" : "warn";
  const kmStatus = p.km != null ? "pass" : "warn";
  
  // Source reliability
  const sourceReliability = (() => {
    const src = (p.source || "").toLowerCase();
    if (src.includes("autotrader")) return { status: "pass" as const, label: "Autotrader (verified)" };
    if (src.includes("drive")) return { status: "pass" as const, label: "Drive (verified)" };
    if (src.includes("gumtree") && src.includes("dealer")) return { status: "warn" as const, label: "Gumtree Dealer (⚠️ verify)" };
    if (src.includes("gumtree") && src.includes("private")) return { status: "warn" as const, label: "Gumtree Private (⚠️⚠️ manual verify)" };
    return { status: "unknown" as const, label: p.source || "Unknown" };
  })();

  // Gap calculations
  const gapMet = (p.gap_dollars ?? 0) > 0;
  const askingPrice = p.asking_price ?? 0;
  const provenExit = p.proven_exit_value ?? 0;
  const gapDollars = p.gap_dollars ?? 0;
  const gapPct = p.gap_pct ?? 0;
  const score = p.match_score ?? 0;

  // Thresholds from hunt or defaults
  const buyGapDollars = hunt?.min_gap_abs_buy ?? 800;
  const buyGapPct = hunt?.min_gap_pct_buy ?? 4;
  const watchGapDollars = hunt?.min_gap_abs_watch ?? 400;
  const watchGapPct = hunt?.min_gap_pct_watch ?? 2;
  const buyScoreMin = 7.5;
  const watchScoreMin = 6.5;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="pb-2">
          <div className="flex items-center gap-3">
            <Badge className={
              alertType === "BUY" 
                ? "bg-emerald-500 text-white text-lg px-3 py-1" 
                : "bg-amber-500 text-white text-lg px-3 py-1"
            }>
              {alertType}
            </Badge>
            <DrawerTitle className="text-lg">
              Why This Matched
            </DrawerTitle>
          </div>
          <DrawerDescription className="mt-1">
            {p.year} {p.make} {p.model} {p.variant && `• ${p.variant}`}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-8 overflow-y-auto space-y-6">
          {/* Guardrails Banner */}
          <div className="p-3 rounded-lg bg-muted/50 text-sm">
            <div className="font-medium mb-1">
              {alertType === "BUY" ? "🎯 BUY = High-confidence strike" : "👀 WATCH = Monitor for movement"}
            </div>
            <div className="text-muted-foreground">
              {alertType === "BUY" 
                ? "Still verify photos, condition report, and spec before bidding."
                : "May need price drop or additional evidence to become a BUY."}
            </div>
            {sourceReliability.status === "warn" && (
              <div className="mt-2 text-amber-600 dark:text-amber-400 font-medium">
                ⚠️ Private/dealer listings require manual verification
              </div>
            )}
          </div>

          {/* Section A: Match Breakdown */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Match Breakdown
            </h3>
            <div className="rounded-lg border divide-y">
              <div className="p-3">
                <MatchCheck 
                  label="Year" 
                  status={yearStatus} 
                  detail={p.year ? `${p.year} (exact)` : "Unknown"} 
                />
                <MatchCheck 
                  label="Make / Model" 
                  status={makeModelStatus} 
                  detail={`${p.make || "?"} ${p.model || "?"}`} 
                />
                <MatchCheck 
                  label="Variant" 
                  status={variantStatus} 
                  detail={p.variant || "Not specified"} 
                />
                <MatchCheck 
                  label="KM" 
                  status={kmStatus} 
                  detail={p.km != null ? `${Math.round(p.km / 1000)}k km` : "Missing"} 
                />
                <MatchCheck 
                  label="Source Reliability" 
                  status={sourceReliability.status} 
                  detail={sourceReliability.label} 
                />
              </div>
            </div>
          </div>

          {/* Section B: Pricing Logic */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Pricing Logic
            </h3>
            <div className="rounded-lg border p-4 space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Asking Price</div>
                  <div className="text-xl font-bold">${askingPrice.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Proven Exit</div>
                  <div className="text-xl font-bold">${provenExit.toLocaleString()}</div>
                </div>
              </div>
              
              <Separator />
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Gap ($)</div>
                  <div className={`text-lg font-semibold ${gapMet ? "text-emerald-500" : "text-muted-foreground"}`}>
                    +${gapDollars.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Gap (%)</div>
                  <div className={`text-lg font-semibold ${gapMet ? "text-emerald-500" : "text-muted-foreground"}`}>
                    {gapPct.toFixed(1)}%
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <div className="text-sm text-muted-foreground mb-2">Decision Threshold</div>
                <div className="text-sm bg-muted/50 p-2 rounded font-mono">
                  {alertType === "BUY" ? (
                    <>
                      <span className="text-emerald-500 font-semibold">BUY</span> because: gap ≥ ${buyGapDollars} AND ≥ {buyGapPct}% AND score ≥ {buyScoreMin} AND km present
                    </>
                  ) : (
                    <>
                      <span className="text-amber-500 font-semibold">WATCH</span> because: gap ≥ ${watchGapDollars} AND ≥ {watchGapPct}% AND score ≥ {watchScoreMin}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Section C: Evidence Quality */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Evidence Quality
            </h3>
            <div className="rounded-lg border p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Match Score</div>
                  <div className="font-semibold">{score.toFixed(1)} / 10</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Confidence</div>
                  <Badge variant="outline" className={
                    score >= 7.5 ? "border-emerald-500 text-emerald-500" :
                    score >= 6.0 ? "border-amber-500 text-amber-500" :
                    "border-muted-foreground"
                  }>
                    {score >= 7.5 ? "High" : score >= 6.0 ? "Medium" : "Low"}
                  </Badge>
                </div>
              </div>
              {p.reasons && p.reasons.length > 0 && (
                <div className="mt-3">
                  <div className="text-sm text-muted-foreground mb-1">Score Factors</div>
                  <div className="flex flex-wrap gap-1">
                    {p.reasons.map((r, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {r}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3 text-xs text-muted-foreground">
                Based on your uploaded sale + proven exit model
              </div>
            </div>
          </div>

          {/* Section D: Raw Snapshot (collapsible) */}
          <Collapsible open={showRaw} onOpenChange={setShowRaw}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                <span className="text-xs text-muted-foreground">Raw Snapshot (Debug)</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${showRaw ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 p-3 bg-muted rounded-lg text-xs overflow-x-auto max-h-48">
                {JSON.stringify(payload, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
