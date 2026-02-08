import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Database, Info } from "lucide-react";
import type { SalesScope } from "@/hooks/useSalesScope";

interface Props {
  scope: SalesScope | undefined;
  isLoading: boolean;
  analysedCount: number;
  rangeLabel: string;
}

export function AnalysisScopeHeader({ scope, isLoading, analysedCount, rangeLabel }: Props) {
  if (isLoading || !scope) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 animate-pulse">
        <div className="h-5 w-48 bg-muted rounded" />
      </div>
    );
  }

  const { totalUploaded, totalUsable } = scope;
  const unusable = totalUploaded - totalUsable;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Database className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 space-y-1">
          {/* Primary line */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-sm font-medium">
              {totalUploaded.toLocaleString()} total sales uploaded
            </span>
            <span className="text-sm text-muted-foreground">
              {analysedCount.toLocaleString()} used in this analysis
              <span className="text-muted-foreground/70"> ({rangeLabel}, complete records)</span>
            </span>
          </div>

          {/* Secondary line */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs font-normal">
              {totalUsable.toLocaleString()} usable records
            </Badge>
            {unusable > 0 && (
              <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                {unusable.toLocaleString()} incomplete — retained
              </Badge>
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[300px] text-xs leading-relaxed">
                  <p className="font-medium mb-1">Analysis scope</p>
                  <ul className="list-disc pl-3.5 space-y-0.5">
                    <li><strong>Total uploaded:</strong> every sales record you've submitted</li>
                    <li><strong>Usable:</strong> records with a sale date and identifiable vehicle</li>
                    <li><strong>Analysed:</strong> usable records within the selected time window</li>
                    <li>Incomplete records are retained and will contribute as data quality improves</li>
                  </ul>
                  <p className="mt-1.5 text-muted-foreground italic">
                    We only draw conclusions where the data is strong enough to speak.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
