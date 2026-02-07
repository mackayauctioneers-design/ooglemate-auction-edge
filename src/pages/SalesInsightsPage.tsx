import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAccounts } from "@/hooks/useAccounts";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { useClearanceVelocity, useVolumeTrends, useVariationPerformance } from "@/hooks/useSalesInsights";
import { VolumeChart } from "@/components/insights/VolumeChart";
import { ClearanceVelocityTable } from "@/components/insights/ClearanceVelocityTable";
import { VariationPerformanceTable } from "@/components/insights/VariationPerformanceTable";
import { TrendingUp } from "lucide-react";
export default function SalesInsightsPage() {
  const { data: accounts } = useAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  // Default to first account
  if (!selectedAccountId && accounts?.length) {
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    if (mackay) setSelectedAccountId(mackay.id);
    else setSelectedAccountId(accounts[0].id);
  }

  const clearance = useClearanceVelocity(selectedAccountId || null);
  const volume = useVolumeTrends(selectedAccountId || null);
  const variation = useVariationPerformance(selectedAccountId || null);

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

        {/* Section 1 — Volume */}
        <VolumeChart data={volume.data || []} isLoading={volume.isLoading} />

        {/* Section 2 — Clearance Velocity */}
        <ClearanceVelocityTable
          data={clearance.data || []}
          isLoading={clearance.isLoading}
        />

        {/* Section 3 — Variation Performance */}
        <VariationPerformanceTable
          data={variation.data || []}
          isLoading={variation.isLoading}
        />

        {/* Section 4 — Trust Footer */}
        <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground leading-relaxed">
            These insights are derived solely from your completed sales history.
            <br />
            They are used to inform Automotive Truth matching — not to judge decisions.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
