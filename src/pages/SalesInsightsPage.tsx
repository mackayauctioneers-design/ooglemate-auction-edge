import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAccounts } from "@/hooks/useAccounts";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { useClearanceVelocity, useVariationPerformance } from "@/hooks/useSalesInsights";
import { useUnexpectedWinners } from "@/hooks/useUnexpectedWinners";
import { useSalesInsightsSummary } from "@/hooks/useSalesInsightsSummary";
import { useSalesScope } from "@/hooks/useSalesScope";
import { DataCoverageSummary } from "@/components/insights/DataCoverageSummary";
import { ClearanceVelocityTable } from "@/components/insights/ClearanceVelocityTable";
import { VariationPerformanceTable } from "@/components/insights/VariationPerformanceTable";
import { UnexpectedWinnersCard } from "@/components/insights/UnexpectedWinnersCard";
import { FingerprintSourcingCard } from "@/components/insights/FingerprintSourcingCard";
import { SalesDrillDownDrawer } from "@/components/insights/SalesDrillDownDrawer";
import { SalesInsightsSummary } from "@/components/insights/SalesInsightsSummary";
import { AskBobSalesTruth } from "@/components/insights/AskBobSalesTruth";
import { TrendingUp, Target, Sparkles } from "lucide-react";

export default function SalesInsightsPage() {
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  const [winnersRange, setWinnersRange] = useState<number | null>(12);
  const [drillDown, setDrillDown] = useState<{ make: string; model: string; range: string } | null>(null);

  const activeAccountId = selectedAccountId || null;
  const selectedAccount = accounts?.find((a) => a.id === selectedAccountId);

  const clearance = useClearanceVelocity(activeAccountId);
  const variation = useVariationPerformance(activeAccountId);
  const unexpectedWinners = useUnexpectedWinners(activeAccountId, winnersRange);
  const salesScope = useSalesScope(activeAccountId);
  const summary = useSalesInsightsSummary(
    activeAccountId,
    clearance.data || [],
    unexpectedWinners.data || []
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="h-6 w-6" />
              Sales Insights
            </h1>
            <p className="text-muted-foreground">
              What your sales history proves about your business
            </p>
          </div>
          <AccountSelector
            value={selectedAccountId}
            onChange={setSelectedAccountId}
          />
        </div>

        {/* Dealer context banner */}
        {selectedAccount && (
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Viewing sales insights for: <span className="font-medium text-foreground">{selectedAccount.display_name}</span>
          </div>
        )}

        {/* Empty state */}
        {!selectedAccountId && (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-12 text-center">
            <p className="text-lg font-medium text-muted-foreground">Select a dealer account above to view insights</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Each dealer's data is analysed independently</p>
          </div>
        )}

        {selectedAccountId && (
        <>
        {/* Data Coverage */}
        <DataCoverageSummary
          scope={salesScope.data}
          isLoading={salesScope.isLoading}
          analysedCount={0}
          rangeLabel=""
        />

        {/* Summary — compressed memory */}
        <SalesInsightsSummary
          bullets={summary.bullets}
          isLoading={summary.isLoading}
          show={summary.showSummary}
        />

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 1 — What You Should Be Buying Again               */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div className="space-y-1 pt-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            What You Should Be Buying Again
          </h2>
          <p className="text-sm text-muted-foreground">
            Each item below is a sourcing instruction derived from your proven sales outcomes — not market averages.
          </p>
        </div>

        <FingerprintSourcingCard accountId={activeAccountId} />

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 2 — Clearance & Variation Detail                  */}
        {/* ═══════════════════════════════════════════════════════════ */}

        <ClearanceVelocityTable
          data={clearance.data || []}
          isLoading={clearance.isLoading}
          fullOutcomeCount={salesScope.data?.totalFullOutcome ?? 0}
        />

        <VariationPerformanceTable
          data={variation.data || []}
          isLoading={variation.isLoading}
          fullOutcomeCount={salesScope.data?.totalFullOutcome ?? 0}
        />

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 3 — Profitable Outcomes Worth Repeating            */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div className="space-y-1 pt-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-400" />
            Profitable Outcomes Worth Repeating
          </h2>
          <p className="text-sm text-muted-foreground">
            These vehicles sold fewer times, but produced strong profit. These outcomes should be watched and opportunistically repeated.
          </p>
        </div>

        <UnexpectedWinnersCard
          data={unexpectedWinners.data || []}
          isLoading={unexpectedWinners.isLoading}
        />

        {/* Ask Bob — Sales Truth */}
        <AskBobSalesTruth
          accountId={selectedAccountId}
          dealerName={selectedAccount?.display_name}
        />

        {/* Trust Footer */}
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground leading-relaxed">
            These insights are derived solely from your completed sales outcomes.
            <br />
            They reflect what you've proven you can sell — not what we think you should.
          </p>
        </div>
        </>
        )}
      </div>

      {/* Drill-Down Drawer */}
      {drillDown && (
        <SalesDrillDownDrawer
          open={!!drillDown}
          onOpenChange={(open) => !open && setDrillDown(null)}
          make={drillDown.make}
          model={drillDown.model}
          accountId={selectedAccountId}
          range={drillDown.range}
        />
      )}
    </AppLayout>
  );
}
