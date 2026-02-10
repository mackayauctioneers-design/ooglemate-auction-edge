import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, Repeat, TrendingUp, Eye, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface CoreEngine {
  vehicle: string;
  reason: string;
  confidence: "HIGH" | "MEDIUM";
}

interface ShapeWinner {
  vehicle: string;
  signal: string;
  note: string;
  confidence: "MEDIUM" | "HIGH";
}

interface OutcomeSignal {
  vehicle: string;
  signal: string;
  instruction: string;
  confidence: "LOW";
}

interface AssessmentResponse {
  summary: string[];
  core_engines: CoreEngine[];
  shape_winners: ShapeWinner[];
  outcome_signals: OutcomeSignal[];
  warnings: string[];
}

interface Props {
  accountId: string;
}

function confidenceBadgeClass(level: string): string {
  switch (level?.toUpperCase()) {
    case "HIGH": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/25";
    case "MEDIUM": return "bg-amber-500/15 text-amber-400 border-amber-500/25";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

export function SalesAssessmentPanel({ accountId }: Props) {
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

  if (isLoading) {
    return (
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5 text-primary" />
            AI Sales Assessment
            <Badge variant="outline" className="text-xs ml-2">read-only</Badge>
          </CardTitle>
          <CardDescription>Interpreting your sales history…</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5 text-primary" />
            AI Sales Assessment
            <Badge variant="outline" className="text-xs ml-2">read-only</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No assessment available yet. Upload more sales data.
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasContent = data.summary.length > 0 || data.core_engines.length > 0 ||
    data.shape_winners.length > 0 || data.outcome_signals.length > 0;

  if (!hasContent && data.warnings.length === 0) {
    return (
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5 text-primary" />
            AI Sales Assessment
            <Badge variant="outline" className="text-xs ml-2">read-only</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No assessment available yet. Upload more sales data.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Brain className="h-5 w-5 text-primary" />
          AI Sales Assessment
          <Badge variant="outline" className="text-xs ml-2">read-only</Badge>
        </CardTitle>
        <CardDescription>
          This summary is based solely on your sales history and system rules.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
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
                  {w.note && (
                    <p className="text-xs text-muted-foreground/70 mt-1 italic">{w.note}</p>
                  )}
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
                    <Badge variant="outline" className="text-xs shrink-0 bg-muted text-muted-foreground border-border">
                      LOW
                    </Badge>
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
      </CardContent>
    </Card>
  );
}
