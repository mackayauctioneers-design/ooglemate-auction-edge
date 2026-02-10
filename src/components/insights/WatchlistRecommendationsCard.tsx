import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, Repeat, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  accountId: string | null;
}

interface WatchCandidate {
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
  median_days_to_clear: number | null;
  target_score: number;
  fingerprint_type: string;
  confidence_level: string;
}

function dnaLabel(c: WatchCandidate): string {
  const parts = [c.make, c.model];
  if (c.variant) parts.push(c.variant);
  if (c.transmission) parts.push(c.transmission);
  if (c.fuel_type) parts.push(c.fuel_type);
  if (c.drive_type) parts.push(c.drive_type);
  return parts.join(" · ");
}

function whyLabel(c: WatchCandidate): string {
  const reasons: string[] = [];
  if (c.median_profit != null && c.median_profit > 0) {
    reasons.push(`$${c.median_profit.toLocaleString()} median margin`);
  }
  if (c.median_days_to_clear != null) {
    reasons.push(`${c.median_days_to_clear}d clearance`);
  }
  if (c.sales_count === 1) {
    reasons.push("single profitable sale — worth watching for repeats");
  } else if (c.sales_count === 2) {
    reasons.push("two profitable sales — building evidence");
  } else {
    reasons.push(`${c.sales_count} proven sales`);
  }
  return reasons.join(" · ");
}

function whereLabel(c: WatchCandidate): string[] {
  const channels: string[] = [];
  channels.push("Auction stock");
  channels.push("Dealer inventory");
  channels.push("Pickles / Manheim");
  return channels;
}

export function WatchlistRecommendationsCard({ accountId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["watch-recommendations", accountId],
    queryFn: async () => {
      if (!accountId) return [];
      const { data, error } = await supabase
        .from("sales_target_candidates")
        .select("make, model, variant, transmission, fuel_type, drive_type, body_type, sales_count, median_profit, median_profit_pct, median_days_to_clear, target_score, fingerprint_type, confidence_level")
        .eq("account_id", accountId)
        .in("status", ["candidate", "active"])
        .order("target_score", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data || []) as WatchCandidate[];
    },
    enabled: !!accountId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            What You Should Be Watching
          </CardTitle>
        </CardHeader>
        <CardContent className="h-48 flex items-center justify-center">
          <p className="text-muted-foreground">Loading sourcing recommendations…</p>
        </CardContent>
      </Card>
    );
  }

  if (!data?.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            What You Should Be Watching
          </CardTitle>
        </CardHeader>
        <CardContent className="py-12 text-center text-muted-foreground">
          Sourcing recommendations will appear after sales data has been processed into target candidates.
        </CardContent>
      </Card>
    );
  }

  const coreItems = data.filter((c) => c.fingerprint_type === "core");
  const outcomeItems = data.filter((c) => c.fingerprint_type === "outcome");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          What You Should Be Watching
        </CardTitle>
        <CardDescription>
          These vehicle shapes are derived from your proven sales outcomes. Each one is a sourcing instruction, not a suggestion.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {coreItems.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Actively hunt — repeatable winners</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {coreItems.map((c, i) => (
                <WatchItem key={`core-${i}`} candidate={c} />
              ))}
            </div>
          </div>
        )}

        {outcomeItems.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Watch &amp; re-test — profitable outcomes</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {outcomeItems.map((c, i) => (
                <WatchItem key={`outcome-${i}`} candidate={c} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WatchItem({ candidate: c }: { candidate: WatchCandidate }) {
  const isOutcome = c.fingerprint_type === "outcome";

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-sm">{dnaLabel(c)}</p>
        <Badge
          variant="outline"
          className={
            isOutcome
              ? "text-xs bg-purple-500/10 text-purple-400 border-purple-500/20 shrink-0"
              : "text-xs bg-primary/10 text-primary border-primary/20 shrink-0"
          }
        >
          {isOutcome ? (
            <><Eye className="h-3 w-3 mr-1" /> Outcome</>
          ) : (
            <><Repeat className="h-3 w-3 mr-1" /> Repeatable</>
          )}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">{whyLabel(c)}</p>

      <div className="flex flex-wrap gap-1.5">
        {whereLabel(c).map((ch) => (
          <Badge key={ch} variant="outline" className="text-xs border-border text-muted-foreground">
            <Search className="h-2.5 w-2.5 mr-1" />
            {ch}
          </Badge>
        ))}
      </div>
    </div>
  );
}
