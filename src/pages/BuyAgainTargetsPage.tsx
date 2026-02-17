import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAccounts } from "@/hooks/useAccounts";
import { useBuyAgainTargets, FingerprintTarget } from "@/hooks/useBuyAgainTargets";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { TargetCard } from "@/components/buy-again/TargetCard";
import { ListingsSearchModal } from "@/components/buy-again/ListingsSearchModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Crosshair, Zap, Pause, Trash2 } from "lucide-react";

export default function BuyAgainTargetsPage() {
  const { data: accounts } = useAccounts();
  const [accountId, setAccountId] = useState("");
  const [searchTarget, setSearchTarget] = useState<FingerprintTarget | null>(null);

  // Auto-select first account
  if (!accountId && accounts?.length) {
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    setAccountId(mackay?.id || accounts[0].id);
  }

  const {
    candidates,
    active,
    paused,
    isLoading,
    seed,
    isSeeding,
    clearAndReseed,
    isClearing,
    promote,
    dismiss,
    pause,
    retire,
    reactivate,
  } = useBuyAgainTargets(accountId);

  const totalTargets = candidates.length + active.length + paused.length;
  const isBusy = isSeeding || isClearing;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Crosshair className="h-6 w-6" />
              Buy Again Targets
            </h1>
            <p className="text-sm text-muted-foreground">
              Your live sourcing engine — built from what you've already proven you can sell.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <AccountSelector value={accountId} onChange={setAccountId} />
            <Button
              onClick={() => seed()}
              disabled={isBusy || !accountId}
              variant="outline"
              size="sm"
            >
              {isSeeding ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Seed From Sales
            </Button>
            <Button
              onClick={() => clearAndReseed()}
              disabled={isBusy || !accountId}
              variant="outline"
              size="sm"
              className="border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              {isClearing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              Clear &amp; Re-Seed
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : totalTargets === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Crosshair className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No active targets</p>
            <p className="text-sm mt-1">
              Click <strong>"Seed From Sales"</strong> to generate targets from your sales history,
              <br />or <strong>"Clear &amp; Re-Seed"</strong> to retire old ones and start fresh.
            </p>
          </div>
        ) : (
          <>
            {/* Section A — Candidates */}
            {candidates.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Candidate Targets
                  </h2>
                  <Badge variant="outline" className="text-xs">{candidates.length}</Badge>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {candidates.map((t) => (
                    <TargetCard
                      key={t.id}
                      target={t}
                      mode="candidate"
                      onPromote={() => promote(t.id)}
                      onDismiss={() => dismiss(t.id)}
                      onSearch={() => setSearchTarget(t)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Section B — Active Targets */}
            {active.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Zap className="h-4 w-4 text-primary" />
                    Active Targets
                  </h2>
                  <Badge variant="outline" className="text-xs">{active.length}</Badge>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {active.map((t) => (
                    <TargetCard
                      key={t.id}
                      target={t}
                      mode="active"
                      onPause={() => pause(t.id)}
                      onRetire={() => retire(t.id)}
                      onSearch={() => setSearchTarget(t)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Section C — Paused */}
            {paused.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Pause className="h-4 w-4" />
                    Paused
                  </h2>
                  <Badge variant="outline" className="text-xs">{paused.length}</Badge>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {paused.map((t) => (
                    <TargetCard
                      key={t.id}
                      target={t}
                      mode="paused"
                      onReactivate={() => reactivate(t.id)}
                      onRetire={() => retire(t.id)}
                      onSearch={() => setSearchTarget(t)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Listings search modal */}
      <ListingsSearchModal
        target={searchTarget}
        open={!!searchTarget}
        onOpenChange={(open) => !open && setSearchTarget(null)}
      />
    </AppLayout>
  );
}