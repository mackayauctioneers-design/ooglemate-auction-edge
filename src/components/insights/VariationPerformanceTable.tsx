import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
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

export function VariationPerformanceTable({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Variations That Perform Best</CardTitle>
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
          <CardTitle>Variations That Perform Best</CardTitle>
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
        <CardTitle>Variations That Perform Best</CardTitle>
        <CardDescription>
          These variations perform best based on your actual sales.
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
              <TableHead className="text-right">Median Days</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, i) => (
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
