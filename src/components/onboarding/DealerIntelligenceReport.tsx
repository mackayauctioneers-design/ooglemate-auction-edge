import { useState, useEffect, useMemo } from "react";
import { BarChart3, Store, Target, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { analyzeDealerSales, type DealerIntelligenceData } from "@/utils/dealerIntelligence";
import { PerformanceReport } from "./PerformanceReport";
import { InventoryAnalysis, type InventoryAnalysisData } from "./InventoryAnalysis";
import { MarketOpportunities, type MarketOpportunitiesData } from "./MarketOpportunities";
import { ReportProgress, type ReportTask } from "./ReportProgress";

interface DealerIntelligenceReportProps {
  salesRows: Record<string, string>[];
  dealerName: string;
  hasWebsite: boolean;
  onContinue: () => void;
}

type TabId = "performance" | "inventory" | "opportunities";

const TABS: { id: TabId; label: string; icon: typeof BarChart3 }[] = [
  { id: "performance", label: "Performance", icon: BarChart3 },
  { id: "inventory", label: "Inventory", icon: Store },
  { id: "opportunities", label: "Opportunities", icon: Target },
];

export function DealerIntelligenceReport({
  salesRows,
  dealerName,
  hasWebsite,
  onContinue,
}: DealerIntelligenceReportProps) {
  const [activeTab, setActiveTab] = useState<TabId>("performance");
  const [isBuilding, setIsBuilding] = useState(true);
  const [tasks, setTasks] = useState<ReportTask[]>([
    { id: "merge", label: "Analyzing sales data…", status: "running" },
    { id: "fingerprint", label: "Building dealer fingerprints…", status: "pending" },
    { id: "inventory", label: "Scanning dealer website…", status: "pending" },
    { id: "market", label: "Finding market opportunities…", status: "pending" },
  ]);

  // Part 1: Analyze sales data (client-side, instant)
  const intelligence = useMemo<DealerIntelligenceData | null>(() => {
    if (!salesRows.length) return null;
    return analyzeDealerSales(salesRows);
  }, [salesRows]);

  // Part 2: Website inventory (placeholder — fed by Lindy async)
  const [inventoryData] = useState<InventoryAnalysisData>({
    totalVehicles: 0,
    avgPriceVsMarket: 0,
    overpriced: 0,
    underpriced: 0,
    underpricedVehicles: [],
    status: hasWebsite ? "pending" : "unavailable",
  });

  // Part 3: Market opportunities (placeholder — fed by OogleBot async)
  const [marketData] = useState<MarketOpportunitiesData>({
    opportunities: [],
    status: "pending",
  });

  // Simulate progressive task completion for the wow-factor delay
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Task 1: Sales analysis (fast)
    timers.push(setTimeout(() => {
      setTasks((prev) => prev.map((t) =>
        t.id === "merge" ? { ...t, status: "done" as const } :
        t.id === "fingerprint" ? { ...t, status: "running" as const } : t
      ));
    }, 1200));

    // Task 2: Fingerprints
    timers.push(setTimeout(() => {
      setTasks((prev) => prev.map((t) =>
        t.id === "fingerprint" ? { ...t, status: "done" as const } :
        t.id === "inventory" ? { ...t, status: hasWebsite ? "running" as const : "done" as const } : t
      ));
    }, 3000));

    // Task 3: Inventory scan
    timers.push(setTimeout(() => {
      setTasks((prev) => prev.map((t) =>
        t.id === "inventory" ? { ...t, status: "done" as const } :
        t.id === "market" ? { ...t, status: "running" as const } : t
      ));
    }, 5000));

    // Task 4: Market scan — then reveal report
    timers.push(setTimeout(() => {
      setTasks((prev) => prev.map((t) =>
        t.id === "market" ? { ...t, status: "done" as const } : t
      ));
    }, 7000));

    timers.push(setTimeout(() => {
      setIsBuilding(false);
    }, 7800));

    return () => timers.forEach(clearTimeout);
  }, [hasWebsite]);

  if (isBuilding) {
    return (
      <div className="max-w-lg mx-auto py-12">
        <ReportProgress tasks={tasks} />
      </div>
    );
  }

  if (!intelligence) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No data to analyze</p>
        <Button onClick={onContinue} className="mt-4">Continue to Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-1">
        <h2 className="text-xl sm:text-2xl font-bold text-foreground">
          {dealerName} Intelligence Report
        </h2>
        <p className="text-sm text-muted-foreground">
          {intelligence.summary.totalSales} sales analyzed · {intelligence.summary.dateRange.earliest && `${intelligence.summary.dateRange.earliest} — ${intelligence.summary.dateRange.latest}`}
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex rounded-lg border border-border bg-muted/30 p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-all",
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "performance" && <PerformanceReport data={intelligence} />}
      {activeTab === "inventory" && <InventoryAnalysis data={inventoryData} />}
      {activeTab === "opportunities" && <MarketOpportunities data={marketData} />}

      {/* CTA */}
      <div className="flex justify-center pt-4">
        <Button onClick={onContinue} size="lg" className="gap-2">
          Launch Dashboard <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
