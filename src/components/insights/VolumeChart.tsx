import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import type { VolumeTrend } from "@/hooks/useSalesInsights";

interface Props {
  data: VolumeTrend[];
  isLoading: boolean;
  onDrillDown?: (make: string, model: string, range: string) => void;
  onScopeChange?: (analysedCount: number, rangeLabel: string) => void;
}

const RANGE_LABELS: Record<string, string> = {
  "3": "3 months",
  "6": "6 months",
  "12": "12 months",
  "all": "all time",
};

export function VolumeChart({ data, isLoading, onDrillDown, onScopeChange }: Props) {
  const [range, setRange] = useState<"3" | "6" | "12" | "all">("12");

  const { chartData, totalSales } = useMemo(() => {
    let filtered = data;
    if (range !== "all") {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - parseInt(range));
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      filtered = data.filter((d) => d.month >= cutoffStr);
    }

    const agg: Record<string, number> = {};
    let total = 0;
    filtered.forEach((d) => {
      const key = `${d.make} ${d.model}`;
      agg[key] = (agg[key] || 0) + d.sales_count;
      total += d.sales_count;
    });

    // Store make/model mapping for click lookup
    const makeModelMap: Record<string, { make: string; model: string }> = {};
    filtered.forEach((d) => {
      const key = `${d.make} ${d.model}`;
      if (!makeModelMap[key]) makeModelMap[key] = { make: d.make, model: d.model };
    });

    const sorted = Object.entries(agg)
      .map(([vehicle, count]) => ({ vehicle, count, make: makeModelMap[vehicle]?.make || "", model: makeModelMap[vehicle]?.model || "" }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { chartData: sorted, totalSales: total };
  }, [data, range]);

  // Notify parent of scope changes
  useEffect(() => {
    onScopeChange?.(totalSales, RANGE_LABELS[range] || range);
  }, [totalSales, range, onScopeChange]);

  const handleBarClick = (data: any) => {
    if (onDrillDown && data?.activePayload?.[0]?.payload) {
      const { make, model } = data.activePayload[0].payload;
      if (make && model) onDrillDown(make, model, range);
    }
  };

  

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What You Should Be Buying Again</CardTitle>
        </CardHeader>
        <CardContent className="h-64 flex items-center justify-center">
          <p className="text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (!chartData.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What You Should Be Buying Again</CardTitle>
        </CardHeader>
        <CardContent className="py-12 text-center text-muted-foreground">
          Upload sales data to see what you've proven you can sell.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>What You Should Be Buying Again</CardTitle>
          <CardDescription className="flex items-center gap-1.5">
            Based on {totalSales} usable records over the last {RANGE_LABELS[range]}.{" "}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px] text-xs leading-relaxed">
                  <p className="font-medium mb-1">Why this number may differ from your total</p>
                  <ul className="list-disc pl-3.5 space-y-0.5">
                    <li>Only usable records within the selected time window are used in this analysis</li>
                    <li>Records require a sale date and identifiable vehicle</li>
                    <li>All uploaded data is acknowledged — this view shows the available data for this period</li>
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardDescription>
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as any)}>
          <TabsList>
            <TabsTrigger value="3">3m</TabsTrigger>
            <TabsTrigger value="6">6m</TabsTrigger>
            <TabsTrigger value="12">12m</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 100, right: 20 }} onClick={handleBarClick} className="cursor-pointer">
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis type="number" className="text-xs fill-muted-foreground" />
            <YAxis
              type="category"
              dataKey="vehicle"
              width={90}
              tick={{ fontSize: 12 }}
              className="fill-muted-foreground"
            />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                color: "hsl(var(--foreground))",
              }}
            />
            <Bar
              dataKey="count"
              fill="hsl(var(--primary))"
              radius={[0, 4, 4, 0]}
              name="Sales"
              className="cursor-pointer"
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
