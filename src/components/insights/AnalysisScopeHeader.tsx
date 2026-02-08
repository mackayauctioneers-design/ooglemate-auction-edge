import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Database, Filter, BarChart3, Info } from "lucide-react";
import type { SalesScope } from "@/hooks/useSalesScope";

interface Props {
  scope: SalesScope | undefined;
  isLoading: boolean;
  analysedCount: number;
  rangeLabel: string;
}

function ScopeStat({
  icon: Icon,
  value,
  label,
  tooltip,
  emphasis = false,
}: {
  icon: React.ElementType;
  value: number;
  label: string;
  tooltip: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-sm tabular-nums ${emphasis ? "font-semibold" : "font-medium"}`}>
            {value.toLocaleString()}
          </span>
          <span className="text-sm text-muted-foreground truncate">{label}</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground/60 cursor-help shrink-0" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[240px] text-xs">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
}

export function AnalysisScopeHeader({ scope, isLoading, analysedCount, rangeLabel }: Props) {
  if (isLoading || !scope) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 animate-pulse">
        <div className="h-16 w-full bg-muted rounded" />
      </div>
    );
  }

  const { totalUploaded, totalUsable } = scope;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Data Scope
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <ScopeStat
          icon={Database}
          value={totalUploaded}
          label="total sales uploaded"
          tooltip="Every sales record you've submitted, including older and incomplete records."
          emphasis
        />
        <ScopeStat
          icon={Filter}
          value={totalUsable}
          label="eligible for analysis"
          tooltip="Records with a sale date and identifiable vehicle (make + model). Incomplete records are retained and will contribute as data quality improves."
        />
        <ScopeStat
          icon={BarChart3}
          value={analysedCount}
          label={`shown in this view (${rangeLabel})`}
          tooltip={`Eligible records within the selected time window. Change the time filter to see more or fewer records.`}
        />
      </div>
    </div>
  );
}
