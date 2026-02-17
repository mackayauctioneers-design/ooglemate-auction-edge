import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Brain, Volume2, VolumeX, Square, AlertTriangle, Target, TrendingDown,
  Gauge, Lightbulb, BarChart3,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CaroogleAiChat } from "./CaroogleAiChat";
import { useSpokenSummary } from "@/hooks/useSpokenSummary";
import bobAvatarSrc from "@/assets/bob-avatar.mp4";

// ── Types (v2 deep assessment) ──
interface ProvenFingerprint {
  make: string;
  model: string;
  badge_variant: string;
  engine_spec: string | null;
  avg_km: number | null;
  count: number;
  avg_profit: number;
  total_profit: number;
  avg_days: number;
  turnover_speed: "Fast" | "Medium" | "Slow";
  recommendation: string;
}

interface KmInsight {
  has_km_data: boolean;
  summary: string;
}

interface AssessmentResponseV2 {
  executive_summary: string;
  proven_fingerprints: ProvenFingerprint[];
  loss_patterns: string[];
  km_insight: KmInsight | null;
  recommendations: string[];
  comparison_note: string | null;
  warnings: string[];
  // Legacy fields (ignored but present)
  summary?: string[];
  core_engines?: any[];
  shape_winners?: any[];
  outcome_signals?: any[];
}

interface Props {
  accountId: string;
  dealerName?: string;
}

function turnoverBadgeClass(speed: string): string {
  switch (speed) {
    case "Fast": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/25";
    case "Medium": return "bg-amber-500/15 text-amber-400 border-amber-500/25";
    case "Slow": return "bg-red-500/15 text-red-400 border-red-500/25";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function formatDollars(n: number | null | undefined): string {
  if (n == null) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`;
}

function buildSpokenSummary(data: AssessmentResponseV2, dealerName?: string): string | null {
  const parts: string[] = [];
  const name = dealerName || "mate";
  parts.push(`G'day ${name}.`);

  if (data.executive_summary) {
    // Take first sentence
    const firstSentence = data.executive_summary.split(". ")[0];
    parts.push(firstSentence + ".");
  }

  if (data.proven_fingerprints.length > 0) {
    const top = data.proven_fingerprints.slice(0, 2);
    const names = top.map(f => `${f.badge_variant} ${f.model}`);
    if (names.length === 2) {
      parts.push(`Your money makers are the ${names[0]} and ${names[1]}.`);
    } else {
      parts.push(`Your money maker is the ${names[0]}.`);
    }
  }

  if (parts.length <= 1) return null;
  return parts.join(" ");
}

export function CaroogleAiSalesPanel({ accountId, dealerName }: Props) {
  const { speak, stop, isSpeaking, isMuted, toggleMute } = useSpokenSummary();

  const { data, isLoading, error } = useQuery<AssessmentResponseV2>({
    queryKey: ["sales-assessment", accountId],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sales-assessment`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ account_id: accountId }),
        }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Assessment failed: ${res.status}`);
      }
      return res.json();
    },
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000,
  });

  const hasAssessment = data && (
    !!data.executive_summary ||
    data.proven_fingerprints?.length > 0 ||
    data.loss_patterns?.length > 0 ||
    data.recommendations?.length > 0
  );

  const spokenSummary = useMemo(() => {
    if (!data || !hasAssessment) return null;
    return buildSpokenSummary(data, dealerName);
  }, [data, hasAssessment, dealerName]);

  const handlePlaySummary = () => {
    if (isSpeaking) { stop(); }
    else if (spokenSummary) { speak(spokenSummary); }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Brain className="h-5 w-5 text-primary" />
              CaroogleAi — Sales Assessment
              <Badge variant="outline" className="text-xs ml-2">deep analysis</Badge>
            </CardTitle>
            <CardDescription>
              Badge-level analysis of {dealerName ? `${dealerName}'s` : "your"} proven sales outcomes.
            </CardDescription>
          </div>
          {spokenSummary && (
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePlaySummary} disabled={isMuted}>
                {isSpeaking ? <Square className="h-4 w-4 text-primary" /> : <Volume2 className="h-4 w-4 text-muted-foreground" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleMute}>
                {isMuted ? <VolumeX className="h-4 w-4 text-muted-foreground/50" /> : <Volume2 className="h-4 w-4 text-muted-foreground/50" />}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Loading */}
        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {/* Empty / Error */}
        {!isLoading && (error || !hasAssessment) && (
          <p className="text-sm text-muted-foreground">
            Upload sales data to activate CaroogleAi insights.
          </p>
        )}

        {/* ── Deep Assessment Content ── */}
        {!isLoading && hasAssessment && data && (
          <>
            {/* Executive Summary */}
            {data.executive_summary && (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
                <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Executive Summary
                </h3>
                <p className="text-sm leading-relaxed">{data.executive_summary}</p>
              </div>
            )}

            {/* Proven Fingerprints Table */}
            {data.proven_fingerprints?.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Target className="h-4 w-4 text-primary" />
                  ✅ Proven Fingerprints — Your Money Makers
                </h3>
                <div className="rounded-md border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Vehicle</TableHead>
                        <TableHead className="text-xs text-right">Count</TableHead>
                        <TableHead className="text-xs text-right">Avg KM</TableHead>
                        <TableHead className="text-xs text-right">Avg Profit</TableHead>
                        <TableHead className="text-xs text-right">Total Profit</TableHead>
                        <TableHead className="text-xs text-right">Avg Days</TableHead>
                        <TableHead className="text-xs">Speed</TableHead>
                        <TableHead className="text-xs">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.proven_fingerprints.map((fp, i) => (
                        <TableRow key={i}>
                          <TableCell className="py-2">
                            <div>
                              <span className="text-sm font-medium">
                                {fp.badge_variant} {fp.model}
                              </span>
                              <span className="text-xs text-muted-foreground ml-1">
                                ({fp.make})
                              </span>
                            </div>
                            {fp.engine_spec && (
                              <span className="text-xs text-muted-foreground">{fp.engine_spec}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm py-2">{fp.count}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground py-2">
                            {fp.avg_km != null && fp.avg_km > 100
                              ? `${Math.round(fp.avg_km / 1000).toLocaleString()}k`
                              : "—"}
                          </TableCell>
                          <TableCell className={`text-right text-sm font-medium py-2 ${fp.avg_profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {formatDollars(fp.avg_profit)}
                          </TableCell>
                          <TableCell className={`text-right text-sm font-bold py-2 ${fp.total_profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {formatDollars(fp.total_profit)}
                          </TableCell>
                          <TableCell className="text-right text-sm py-2">{Math.round(fp.avg_days)}d</TableCell>
                          <TableCell className="py-2">
                            <Badge variant="outline" className={`text-xs ${turnoverBadgeClass(fp.turnover_speed)}`}>
                              {fp.turnover_speed}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground py-2 max-w-[160px]">
                            {fp.recommendation}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Loss Patterns */}
            {data.loss_patterns?.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <TrendingDown className="h-4 w-4 text-red-400" />
                  ⚠️ Loss Patterns to Avoid
                </h3>
                <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3 space-y-1.5">
                  {data.loss_patterns.map((lp, i) => (
                    <p key={i} className="text-sm flex items-start gap-2">
                      <span className="text-red-400 mt-0.5 shrink-0">•</span>
                      <span>{lp}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* KM Insight */}
            {data.km_insight && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Gauge className="h-4 w-4 text-muted-foreground" />
                  KM Band Insight
                </h3>
                <p className="text-sm text-muted-foreground rounded-md border border-border bg-muted/20 p-3">
                  {data.km_insight.summary}
                </p>
              </div>
            )}

            {/* Recommendations */}
            {data.recommendations?.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Lightbulb className="h-4 w-4 text-amber-400" />
                  Actionable Recommendations
                </h3>
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-1.5">
                  {data.recommendations.map((rec, i) => (
                    <p key={i} className="text-sm flex items-start gap-2">
                      <span className="text-primary mt-0.5 shrink-0">→</span>
                      <span>{rec}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Comparison Note */}
            {data.comparison_note && (
              <p className="text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-3">
                {data.comparison_note}
              </p>
            )}

            {/* Warnings */}
            {data.warnings?.length > 0 && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                {data.warnings.map((w, i) => (
                  <p key={i} className="text-xs flex items-start gap-1.5 text-amber-400/90">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </p>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Divider ── */}
        <Separator />

        {/* ── Bob Chat Section ── */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full overflow-hidden bg-muted shrink-0 border-2 border-primary/30">
              <video src={bobAvatarSrc} autoPlay loop muted playsInline className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-sm font-semibold">Bob — Your CaroogleAi assistant</p>
              <p className="text-xs text-muted-foreground">
                Ask CaroogleAi about {dealerName ? `${dealerName}'s` : "your"} sales
              </p>
            </div>
          </div>
          <CaroogleAiChat accountId={accountId} dealerName={dealerName} />
        </div>
      </CardContent>
    </Card>
  );
}
