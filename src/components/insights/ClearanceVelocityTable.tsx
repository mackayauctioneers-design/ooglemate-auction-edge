import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { ClearanceVelocity } from "@/hooks/useSalesInsights";

interface Props {
  data: ClearanceVelocity[];
  isLoading: boolean;
}

function speedBadge(days: number | null) {
  if (days === null) return <span className="text-muted-foreground">—</span>;
  if (days <= 21)
    return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">{days}d</Badge>;
  if (days <= 45)
    return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">{days}d</Badge>;
  return <Badge className="bg-red-500/10 text-red-600 border-red-500/20">{days}d</Badge>;
}

export function ClearanceVelocityTable({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What Clears the Fastest</CardTitle>
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
          <CardTitle>What Clears the Fastest</CardTitle>
        </CardHeader>
        <CardContent className="py-12 text-center text-muted-foreground">
          Clearance velocity will appear once sales include acquisition and sale dates.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>What Clears the Fastest</CardTitle>
        <CardDescription>
          These vehicles typically clear quickly for you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vehicle</TableHead>
              <TableHead className="text-right">Median Days</TableHead>
              <TableHead className="text-right">% &lt; 30d</TableHead>
              <TableHead className="text-right">% &lt; 60d</TableHead>
              <TableHead className="text-right">Sales</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, i) => (
              <TableRow key={i}>
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
                  {row.pct_under_30 !== null ? `${row.pct_under_30}%` : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {row.pct_under_60 !== null ? `${row.pct_under_60}%` : "—"}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {row.sales_count}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
