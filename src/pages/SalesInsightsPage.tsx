import { useCallback, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAccounts } from "@/hooks/useAccounts";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { useClearanceVelocity, useVolumeTrends, useVariationPerformance } from "@/hooks/useSalesInsights";
import { useUnexpectedWinners } from "@/hooks/useUnexpectedWinners";
import { useSalesInsightsSummary } from "@/hooks/useSalesInsightsSummary";
import { useSalesScope } from "@/hooks/useSalesScope";
import { VolumeChart } from "@/components/insights/VolumeChart";
import { DataCoverageSummary } from "@/components/insights/DataCoverageSummary";
import { ClearanceVelocityTable } from "@/components/insights/ClearanceVelocityTable";
import { VariationPerformanceTable } from "@/components/insights/VariationPerformanceTable";
import { UnexpectedWinnersCard } from "@/components/insights/UnexpectedWinnersCard";
import { SalesDrillDownDrawer } from "@/components/insights/SalesDrillDownDrawer";
import { SalesInsightsSummary } from "@/components/insights/SalesInsightsSummary";
import { TrendingUp } from "lucide-react";

export default function SalesInsightsPage() {
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  // Time range for unexpected winners (synced concept)
  const [winnersRange, setWinnersRange] = useState<number | null>(12); // null = all time

  // Scope tracking — receives analysed count & label from VolumeChart
  const [analysedCount, setAnalysedCount] = useState(0);
  const [rangeLabel, setRangeLabel] = useState("12 months");

  // Drill-down state
  const [drillDown, setDrillDown] = useState<{ make: string; model: string; range: string } | null>(null);

  // Default to first account
  if (!selectedAccountId && accounts?.length) {
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    if (mackay) setSelectedAccountId(mackay.id);
    else setSelectedAccountId(accounts[0].id);
  }

  const clearance = useClearanceVelocity(selectedAccountId || null);
  const volume = useVolumeTrends(selectedAccountId || null);
  const variation = useVariationPerformance(selectedAccountId || null);
  const unexpectedWinners = useUnexpectedWinners(selectedAccountId || null, winnersRange);
  const salesScope = useSalesScope(selectedAccountId || null);
  const summary = useSalesInsightsSummary(
    selectedAccountId || null,
    clearance.data || [],
    unexpectedWinners.data || []
  );

  const handleScopeChange = useCallback((count: number, label: string) => {
    setAnalysedCount(count);
    setRangeLabel(label);
  }, []);

  const handleDrillDown = (make: string, model: string, range: string) => {
    setDrillDown({ make, model, range });
  };

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
              What your sales history reveals about your business
            </p>
          </div>
          <AccountSelector
            value={selectedAccountId}
            onChange={setSelectedAccountId}
          />
        </div>

        {/* 1️⃣ Data Coverage Summary — always visible, neutral tone */}
        <DataCoverageSummary
          scope={salesScope.data}
          isLoading={salesScope.isLoading}
          analysedCount={analysedCount}
          rangeLabel={rangeLabel}
        />

        {/* Section 1 — Volume */}
        <VolumeChart
          data={volume.data || []}
          isLoading={volume.isLoading}
          onDrillDown={handleDrillDown}
          onScopeChange={handleScopeChange}
        />

        {/* Section 2 — Clearance Velocity */}
        <ClearanceVelocityTable
          data={clearance.data || []}
          isLoading={clearance.isLoading}
          fullOutcomeCount={salesScope.data?.totalFullOutcome ?? 0}
        />

        {/* Section 3 — Variation Performance */}
        <VariationPerformanceTable
          data={variation.data || []}
          isLoading={variation.isLoading}
          fullOutcomeCount={salesScope.data?.totalFullOutcome ?? 0}
        />

        {/* Section 4 — Unexpected Winners */}
        <UnexpectedWinnersCard
          data={unexpectedWinners.data || []}
          isLoading={unexpectedWinners.isLoading}
        />

        {/* Section 5 — Summary */}
        <SalesInsightsSummary
          bullets={summary.bullets}
          isLoading={summary.isLoading}
          show={summary.showSummary}
        />

        {/* Section 6 — Trust Footer */}
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground leading-relaxed">
            These insights are derived solely from your sales history.
            <br />
            They are used to inform Automotive Truth matching — not to judge decisions.
          </p>
        </div>
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
