import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { useAccounts } from "@/hooks/useAccounts";
import { toast } from "sonner";
import {
  Target,
  CheckCircle,
  SkipForward,
  Copy,
  Loader2,
  RefreshCw,
  Sparkles,
  Eye,
} from "lucide-react";

export default function JoshDailyTargetsPage() {
  const { data: accounts } = useAccounts();
  const [accountId, setAccountId] = useState("");
  const queryClient = useQueryClient();

  if (!accountId && accounts?.length) {
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    setAccountId(mackay?.id || accounts[0].id);
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data: targets, isLoading } = useQuery({
    queryKey: ["josh-daily-targets", accountId, today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("josh_daily_targets")
        .select("*, sales_target_candidates(*)")
        .eq("account_id", accountId)
        .eq("target_date", today)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!accountId,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "generate-daily-targets",
        { body: { account_id: accountId, n: 15 } }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["josh-daily-targets"] });
      if (data.created > 0) {
        toast.success(`Generated ${data.created} daily targets`);
      } else {
        toast.info(data.message || "Targets already generated for today");
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({
      id,
      status,
      notes,
    }: {
      id: string;
      status: string;
      notes?: string;
    }) => {
      const update: any = {
        status,
        completed_at: status !== "open" ? new Date().toISOString() : null,
      };
      if (notes !== undefined) update.notes = notes;
      const { error } = await supabase
        .from("josh_daily_targets")
        .update(update)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["josh-daily-targets"] });
    },
  });

  const copySearchString = (candidate: any) => {
    const parts = [candidate.make, candidate.model];
    if (candidate.variant) parts.push(candidate.variant);
    const searchStr = parts.join(" ");
    navigator.clipboard.writeText(searchStr);
    toast.success(`Copied: "${searchStr}"`);
  };

  const openTargets = (targets || []).filter(
    (t: any) => t.status === "open"
  );
  const completedTargets = (targets || []).filter(
    (t: any) => t.status !== "open"
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Target className="h-6 w-6" />
              Daily Targets
            </h1>
            <p className="text-sm text-muted-foreground">
              Your job is to find these vehicles anywhere they exist and feed
              URLs into the system. The system decides what matters.
            </p>
          </div>
          <div className="flex gap-2">
            <AccountSelector value={accountId} onChange={setAccountId} />
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending || !accountId}
              variant="outline"
            >
              {generateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Generate Today
            </Button>
          </div>
        </div>

        {/* Truth disclaimer */}
        <div className="flex items-start gap-2 text-sm bg-muted/50 border rounded-lg p-3">
          <Sparkles className="h-4 w-4 mt-0.5 text-primary" />
          <span>
            Chosen from your sales history — not market data. Each target
            represents a vehicle shape with proven outcomes.
          </span>
        </div>

        {/* Progress */}
        {targets && targets.length > 0 && (
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-sm">
              {completedTargets.length}/{targets.length} completed
            </Badge>
            <div className="flex-1 bg-muted rounded-full h-2">
              <div
                className="bg-primary rounded-full h-2 transition-all"
                style={{
                  width: `${(completedTargets.length / targets.length) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !targets?.length ? (
          <div className="text-center py-12 text-muted-foreground">
            <Target className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No targets for today</p>
            <p className="text-sm">
              Click "Generate Today" to create daily targets from your
              candidates pool.
            </p>
          </div>
        ) : (
          <>
            {/* Open targets */}
            {openTargets.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Open ({openTargets.length})
                </h2>
                {openTargets.map((t: any) => (
                  <TargetCard
                    key={t.id}
                    target={t}
                    onDone={() =>
                      updateStatus.mutate({ id: t.id, status: "done" })
                    }
                    onSkip={(reason) =>
                      updateStatus.mutate({
                        id: t.id,
                        status: "skipped",
                        notes: reason,
                      })
                    }
                    onCopy={() =>
                      copySearchString(t.sales_target_candidates)
                    }
                  />
                ))}
              </div>
            )}

            {/* Completed */}
            {completedTargets.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Completed ({completedTargets.length})
                </h2>
                {completedTargets.map((t: any) => (
                  <TargetCard
                    key={t.id}
                    target={t}
                    completed
                    onCopy={() =>
                      copySearchString(t.sales_target_candidates)
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}

// ============================================================================
// TargetCard component
// ============================================================================

function TargetCard({
  target,
  completed = false,
  onDone,
  onSkip,
  onCopy,
}: {
  target: any;
  completed?: boolean;
  onDone?: () => void;
  onSkip?: (reason: string) => void;
  onCopy?: () => void;
}) {
  const [showSkipInput, setShowSkipInput] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const c = target.sales_target_candidates;

  if (!c) return null;

  return (
    <Card
      className={
        completed
          ? "opacity-60 border-muted"
          : "border-primary/20"
      }
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">
              {c.make} {c.model}
              {c.variant && (
                <span className="text-muted-foreground font-normal ml-2">
                  {c.variant}
                </span>
              )}
            </CardTitle>
            {c.fingerprint_type === "outcome" ? (
              <Badge variant="outline" className="bg-purple-500/10 text-purple-700 border-purple-300 text-xs">
                <Eye className="h-3 w-3 mr-1" />
                Outcome
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-300 text-xs">
                Repeatable
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`inline-flex items-center justify-center w-8 h-8 rounded-lg font-bold text-sm ${
                c.target_score >= 70
                  ? "bg-green-500/10 text-green-700"
                  : c.target_score >= 40
                  ? "bg-yellow-500/10 text-yellow-700"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {c.target_score}
            </div>
            {target.status === "done" && (
              <Badge className="bg-green-500/10 text-green-700 border-green-300">
                Done
              </Badge>
            )}
            {target.status === "skipped" && (
              <Badge className="bg-yellow-500/10 text-yellow-700 border-yellow-300">
                Skipped
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {c.fingerprint_type === "outcome" && (
          <p className="text-xs text-purple-600/80 mb-2 italic">
            Profitable singleton — watch &amp; re-test if found again
          </p>
        )}
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
          <span>
            Sold <strong className="text-foreground">{c.sales_count}×</strong>
          </span>
          {c.median_days_to_clear != null && (
            <span>
              Typically clears in{" "}
              <strong className="text-foreground">
                {c.median_days_to_clear}d
              </strong>
            </span>
          )}
          {c.median_sale_price != null && (
            <span>
              Median{" "}
              <strong className="text-foreground">
                ${c.median_sale_price.toLocaleString()}
              </strong>
            </span>
          )}
          {c.median_km != null && (
            <span>
              ~
              <strong className="text-foreground">
                {(c.median_km / 1000).toFixed(0)}k
              </strong>{" "}
              km
            </span>
          )}
        </div>

        {target.notes && (
          <p className="text-sm text-muted-foreground italic mb-3">
            {target.notes}
          </p>
        )}

        {!completed && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onCopy}>
              <Copy className="h-3.5 w-3.5 mr-1" />
              Copy Search
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={onDone}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle className="h-3.5 w-3.5 mr-1" />
              Done
            </Button>
            {!showSkipInput ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowSkipInput(true)}
              >
                <SkipForward className="h-3.5 w-3.5 mr-1" />
                Skip
              </Button>
            ) : (
              <div className="flex gap-1 flex-1">
                <Textarea
                  placeholder="Reason (optional)"
                  value={skipReason}
                  onChange={(e) => setSkipReason(e.target.value)}
                  className="h-8 min-h-0 text-xs"
                  rows={1}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onSkip?.(skipReason);
                    setShowSkipInput(false);
                  }}
                >
                  Skip
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
