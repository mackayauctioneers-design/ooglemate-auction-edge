import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { VolumeTrend } from "@/hooks/useSalesInsights";

interface Props {
  data: VolumeTrend[];
  isLoading: boolean;
}

export function VolumeChart({ data, isLoading }: Props) {
  const [range, setRange] = useState<"3" | "6" | "12">("12");

  const chartData = useMemo(() => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - parseInt(range));
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Aggregate by make/model across filtered months
    const agg: Record<string, number> = {};
    data
      .filter((d) => d.month >= cutoffStr)
      .forEach((d) => {
        const key = `${d.make} ${d.model}`;
        agg[key] = (agg[key] || 0) + d.sales_count;
      });

    return Object.entries(agg)
      .map(([vehicle, count]) => ({ vehicle, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [data, range]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What You Sell the Most</CardTitle>
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
          <CardTitle>What You Sell the Most</CardTitle>
        </CardHeader>
        <CardContent className="py-12 text-center text-muted-foreground">
          Upload sales data to see what you consistently sell.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>What You Sell the Most</CardTitle>
          <CardDescription>
            These are the vehicles you consistently sell.
          </CardDescription>
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as any)}>
          <TabsList>
            <TabsTrigger value="3">3m</TabsTrigger>
            <TabsTrigger value="6">6m</TabsTrigger>
            <TabsTrigger value="12">12m</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 100, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis type="number" className="text-xs fill-muted-foreground" />
            <YAxis
              type="category"
              dataKey="vehicle"
              width={90}
              tick={{ fontSize: 12 }}
              className="fill-muted-foreground"
            />
            <Tooltip
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
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
