import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { VariationPerformance } from "@/hooks/useSalesInsights";

interface Props {
  data: VariationPerformance[];
  isLoading: boolean;
}

function formatPrice(v: number | null) {
  if (v === null) return "—";
  return `$${v.toLocaleString()}`;
}

function formatKm(v: number | null) {
  if (v === null) return "—";
  return `${(v / 1000).toFixed(0)}k`;
}

function marginCell(dollars: number | null) {
  if (dollars == null) return <span className="text-muted-foreground">—</span>;
  const label = `$${Math.abs(dollars).toLocaleString()}`;
  if (dollars >= 5000) return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs">{label}</Badge>;
  if (dollars >= 1000) return <span className="text-sm">{label}</span>;
  if (dollars >= 0) return <span className="text-sm text-muted-foreground">{label}</span>;
  return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-xs">-{label}</Badge>;
}

export function VariationPerformanceTable({ data, isLoading }: Props) {
  // Best-first ordering: highest profit first
  const sorted = [...data].sort(
    (a, b) => (b.median_profit_dollars ?? -Infinity) - (a.median_profit_dollars ?? -Infinity)
  );
  const totalSales = data.reduce((sum, r) => sum + r.sales_count, 0);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Strongest Variations</CardTitle>
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
          <CardTitle>Your Strongest Variations</CardTitle>
        </CardHeader>
        <CardContent className="py-12 text-center text-muted-foreground">
          Variation insights will appear after uploading sales with variant, transmission, or fuel data.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Strongest Variations</CardTitle>
        <CardDescription>
          Based on {totalSales} completed sales. Most consistent variations shown first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehicle</TableHead>
              <TableHead>Variant</TableHead>
              <TableHead>Trans.</TableHead>
              <TableHead>Fuel</TableHead>
              <TableHead className="text-right">Sales</TableHead>
              <TableHead className="text-right">Median KM</TableHead>
              <TableHead className="text-right">Median Price</TableHead>
              <TableHead className="text-right">Median Margin</TableHead>
              <TableHead className="text-right">Median Days</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">
                  {row.make} {row.model}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {row.variant || "—"}
                </TableCell>
                <TableCell className="text-sm">
                  {row.transmission || "—"}
                </TableCell>
                <TableCell className="text-sm">
                  {row.fuel_type || "—"}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {row.sales_count}
                </TableCell>
                <TableCell className="text-right">
                  {formatKm(row.median_km)}
                </TableCell>
                <TableCell className="text-right">
                  {formatPrice(row.median_sale_price)}
                </TableCell>
                <TableCell className="text-right">
                  {marginCell(row.median_profit_dollars)}
                </TableCell>
                <TableCell className="text-right">
                  {row.median_days_to_clear !== null ? `${row.median_days_to_clear}d` : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
