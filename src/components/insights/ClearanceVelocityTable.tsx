import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { ClearanceVelocity } from "@/hooks/useSalesInsights";

interface Props {
  data: ClearanceVelocity[];
  isLoading: boolean;
  fullOutcomeCount?: number;
}

const FAST_THRESHOLD = 45; // days — anything above this is "longer clearance"

function speedBadge(days: number | null) {
  if (days === null) return <span className="text-muted-foreground text-xs italic">Clearance data unavailable</span>;
  if (days <= 21)
    return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">{days}d — clears quickly</Badge>;
  if (days <= 45)
    return <Badge variant="outline" className="bg-muted text-muted-foreground border-border">{days}d — clears consistently</Badge>;
  return <Badge variant="outline" className="bg-muted text-muted-foreground border-border">{days}d — longer clearance observed</Badge>;
}

function marginCell(dollars: number | null) {
  if (dollars == null) return <span className="text-muted-foreground text-xs italic">Margin data unavailable</span>;
  const label = `$${Math.abs(dollars).toLocaleString()}`;
  if (dollars >= 5000) return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs">{label}</Badge>;
  if (dollars >= 1000) return <span className="text-sm">{label}</span>;
  if (dollars >= 0) return <span className="text-sm text-muted-foreground">{label}</span>;
  return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-xs">-{label}</Badge>;
}

export function ClearanceVelocityTable({ data, isLoading, fullOutcomeCount = 0 }: Props) {
  const [showSlower, setShowSlower] = useState(false);

  // Best-first ordering: sorted by median_profit_dollars descending (highest profit first)
  const sorted = [...data].sort(
    (a, b) => (b.median_profit_dollars ?? -Infinity) - (a.median_profit_dollars ?? -Infinity)
  );

  const fastRows = sorted.filter(
    (r) => r.median_days_to_clear !== null && r.median_days_to_clear <= FAST_THRESHOLD
  );
  const slowerRows = sorted.filter(
    (r) => r.median_days_to_clear === null || r.median_days_to_clear > FAST_THRESHOLD
  );

  const visibleRows = showSlower ? [...fastRows, ...slowerRows] : fastRows;
  const totalSales = data.reduce((sum, r) => sum + r.sales_count, 0);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What Clears Consistently</CardTitle>
        </CardHeader>
        <CardContent className="h-48 flex items-center justify-center">
          <p className="text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  if (!data.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What Clears Consistently</CardTitle>
        </CardHeader>
        <CardContent className="py-12 text-center text-muted-foreground">
          Clearance patterns will appear once sales include acquisition and sale dates.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>What Clears Consistently</CardTitle>
        <CardDescription>
          Based on {fullOutcomeCount > 0 ? fullOutcomeCount : totalSales} sales with full outcome data.{" "}
          <span className="text-muted-foreground/60">(buy price, sale price, and clearance time present)</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehicle</TableHead>
              <TableHead className="text-right">Median Days</TableHead>
              <TableHead className="text-right">Median Margin</TableHead>
              <TableHead className="text-right">% &lt; 30d</TableHead>
              <TableHead className="text-right">% &lt; 60d</TableHead>
              <TableHead className="text-right">Sales</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row, i) => {
              const hasPartialData = row.median_days_to_clear === null || row.median_profit_dollars === null;
              return (
                <TableRow key={i} className={hasPartialData ? "opacity-60" : ""}>
                  <TableCell className="font-medium">
                    {row.make} {row.model}
                    {row.variant && (
                      <span className="text-muted-foreground ml-1 text-xs">{row.variant}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {speedBadge(row.median_days_to_clear)}
                  </TableCell>
                  <TableCell className="text-right">
                    {marginCell(row.median_profit_dollars)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.pct_under_30 !== null ? `${row.pct_under_30}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.pct_under_60 !== null ? `${row.pct_under_60}%` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {row.sales_count}
                  </TableCell>
                </TableRow>
              );
            })}
            {!visibleRows.length && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                  No vehicles with full outcome data in this range.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {slowerRows.length > 0 && (
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <Switch
              id="show-slower"
              checked={showSlower}
              onCheckedChange={setShowSlower}
            />
            <Label htmlFor="show-slower" className="text-sm text-muted-foreground cursor-pointer">
              Show vehicles with longer clearance times ({slowerRows.length})
            </Label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
