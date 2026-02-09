import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileBarChart } from "lucide-react";
import type { SalesScope } from "@/hooks/useSalesScope";

interface Props {
  scope: SalesScope | undefined;
  isLoading: boolean;
  analysedCount: number;
  rangeLabel: string;
}

export function DataCoverageSummary({ scope, isLoading, analysedCount, rangeLabel }: Props) {
  if (isLoading || !scope) {
    return (
      <Card>
        <CardContent className="p-5 animate-pulse">
          <div className="h-20 w-full bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  const { totalUploaded, totalUsable, totalFullOutcome } = scope;

  const items = [
    {
      value: totalUploaded,
      label: "total sales uploaded",
    },
    {
      value: totalUsable,
      label: "usable records",
      sub: "vehicle identity + sale date present",
    },
    {
      value: analysedCount,
      label: `within selected period`,
      sub: rangeLabel,
    },
    {
      value: totalFullOutcome,
      label: "with full outcome data",
      sub: "buy price, sale price, and clearance time",
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileBarChart className="h-4 w-4 text-muted-foreground" />
          Data coverage for this report
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item, i) => (
            <div key={i} className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tabular-nums">
                {item.value.toLocaleString()}
              </span>
              <div className="min-w-0">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                {item.sub && (
                  <p className="text-xs text-muted-foreground/60 truncate">{item.sub}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
