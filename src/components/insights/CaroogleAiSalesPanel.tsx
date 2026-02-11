import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Brain, Repeat, TrendingUp, Eye, AlertTriangle, Volume2, VolumeX, Square } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CaroogleAiChat } from "./CaroogleAiChat";
import { useSpokenSummary } from "@/hooks/useSpokenSummary";
import bobAvatarSrc from "@/assets/bob-avatar.mp4";

// ── Types ──
interface CoreEngine { vehicle: string; reason: string; confidence: "HIGH" | "MEDIUM"; }
interface ShapeWinner { vehicle: string; signal: string; note: string; confidence: "MEDIUM" | "HIGH"; }
interface OutcomeSignal { vehicle: string; signal: string; instruction: string; confidence: "LOW"; }
interface AssessmentResponse {
  summary: string[];
  core_engines: CoreEngine[];
  shape_winners: ShapeWinner[];
  outcome_signals: OutcomeSignal[];
  warnings: string[];
}

interface Props {
  accountId: string;
  dealerName?: string;
}

function confidenceBadgeClass(level: string): string {
  switch (level?.toUpperCase()) {
    case "HIGH": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/25";
    case "MEDIUM": return "bg-amber-500/15 text-amber-400 border-amber-500/25";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

/** Build a concise spoken summary (max ~50 words, deal captain tone) from assessment data */
function buildSpokenSummary(data: AssessmentResponse, dealerName?: string): string | null {
  const parts: string[] = [];
  const name = dealerName || "mate";

  parts.push(`G'day ${name}.`);

  // Core engines — mention top 1-2 with conviction
  if (data.core_engines.length > 0) {
    const top = data.core_engines.slice(0, 2);
    if (top.length === 1) {
      parts.push(`Your money maker is the ${top[0].vehicle}. That's where your edge lives.`);
    } else {
      parts.push(`Right now I'd be hunting ${top[0].vehicle} and ${top[1].vehicle}. That's where your margin sits.`);
    }
  }

  // Outcome signals — brief mention
  if (data.outcome_signals.length > 0) {
    parts.push(`Plus ${data.outcome_signals.length} one-off win${data.outcome_signals.length > 1 ? "s" : ""} worth chasing again.`);
  }

  if (parts.length <= 1) return null;

  return parts.join(" ");
}

export function CaroogleAiSalesPanel({ accountId, dealerName }: Props) {
  const { speak, stop, isSpeaking, isMuted, toggleMute } = useSpokenSummary();

  const { data, isLoading, error } = useQuery<AssessmentResponse>({
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
      if (!res.ok) throw new Error(`Assessment failed: ${res.status}`);
      return res.json();
    },
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000,
  });

  const hasAssessment = data && (
    data.summary.length > 0 || data.core_engines.length > 0 ||
    data.shape_winners.length > 0 || data.outcome_signals.length > 0 ||
    data.warnings.length > 0
  );

  const spokenSummary = useMemo(() => {
    if (!data || !hasAssessment) return null;
    return buildSpokenSummary(data, dealerName);
  }, [data, hasAssessment, dealerName]);

  const handlePlaySummary = () => {
    if (isSpeaking) {
      stop();
    } else if (spokenSummary) {
      speak(spokenSummary);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Brain className="h-5 w-5 text-primary" />
              CaroogleAi — Sales Assessment
              <Badge variant="outline" className="text-xs ml-2">read-only</Badge>
            </CardTitle>
            <CardDescription>
              Powered by CaroogleAi · Based solely on {dealerName ? `${dealerName}'s` : "your"} sales history and system rules.
            </CardDescription>
          </div>

          {/* Speaker controls */}
          {spokenSummary && (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handlePlaySummary}
                title={isSpeaking ? "Stop summary" : "Listen to summary"}
                disabled={isMuted}
              >
                {isSpeaking ? (
                  <Square className="h-4 w-4 text-primary" />
                ) : (
                  <Volume2 className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={toggleMute}
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? (
                  <VolumeX className="h-4 w-4 text-muted-foreground/50" />
                ) : (
                  <Volume2 className="h-4 w-4 text-muted-foreground/50" />
                )}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ── Assessment Section ── */}
        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {!isLoading && (error || !hasAssessment) && (
          <p className="text-sm text-muted-foreground">
            Upload sales data to activate CaroogleAi insights.
          </p>
        )}

        {!isLoading && hasAssessment && data && (
          <>
            {/* Summary bullets */}
            {data.summary.length > 0 && (
              <ul className="space-y-1.5">
                {data.summary.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-muted-foreground mt-0.5 shrink-0">•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Core Engines */}
            {data.core_engines.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Repeat className="h-4 w-4 text-primary" />
                  Core Engines
                </h3>
                <div className="space-y-2">
                  {data.core_engines.map((e, i) => (
                    <div key={i} className="rounded-md border border-border bg-muted/20 p-3 flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium">{e.vehicle}</p>
                        <p className="text-xs text-muted-foreground">{e.reason}</p>
                      </div>
                      <Badge variant="outline" className={`text-xs shrink-0 ${confidenceBadgeClass(e.confidence)}`}>
                        {e.confidence}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Shape Winners */}
            {data.shape_winners.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Shape Winners
                </h3>
                <div className="space-y-2">
                  {data.shape_winners.map((w, i) => (
                    <div key={i} className="rounded-md border border-border bg-muted/20 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium">{w.vehicle}</p>
                          <p className="text-xs text-muted-foreground">{w.signal}</p>
                        </div>
                        <Badge variant="outline" className={`text-xs shrink-0 ${confidenceBadgeClass(w.confidence)}`}>
                          {w.confidence}
                        </Badge>
                      </div>
                      {w.note && <p className="text-xs text-muted-foreground/70 mt-1 italic">{w.note}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Outcome Signals */}
            {data.outcome_signals.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Eye className="h-4 w-4 text-accent-foreground" />
                  Outcome Signals
                </h3>
                <div className="space-y-2">
                  {data.outcome_signals.map((o, i) => (
                    <div key={i} className="rounded-md border border-border bg-muted/20 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium">{o.vehicle}</p>
                          <p className="text-xs text-muted-foreground">{o.signal}</p>
                        </div>
                        <Badge variant="outline" className="text-xs shrink-0 bg-muted text-muted-foreground border-border">LOW</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground/70 mt-1 italic">{o.instruction}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warnings */}
            {data.warnings.length > 0 && (
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
              <video
                src={bobAvatarSrc}
                autoPlay
                loop
                muted
                playsInline
                className="h-full w-full object-cover"
              />
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
