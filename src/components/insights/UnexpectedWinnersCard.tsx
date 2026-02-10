import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Sparkles, Zap, TrendingUp, Percent } from "lucide-react";
import type { UnexpectedWinner } from "@/hooks/useUnexpectedWinners";

interface Props {
  data: UnexpectedWinner[];
  isLoading: boolean;
}

function formatPrice(price: number | null) {
  if (price == null) return "—";
  return `$${price.toLocaleString()}`;
}

function formatDays(days: number | null) {
  if (days == null) return null;
  return `${days}d`;
}

export function UnexpectedWinnersCard({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Profitable Outcomes Worth Repeating
          </CardTitle>
        </CardHeader>
        <CardContent className="h-48 flex items-center justify-center">
          <p className="text-muted-foreground">Analysing outcomes…</p>
        </CardContent>
      </Card>
    );
  }

  if (!data.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Profitable Outcomes Worth Repeating
          </CardTitle>
        </CardHeader>
        <CardContent className="py-12 text-center text-muted-foreground">
          No low-frequency profitable outcomes detected yet. As more sales are recorded, singleton wins will surface here.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Profitable Outcomes Worth Repeating
          </CardTitle>
          <CardDescription className="flex items-center gap-1.5">
            These vehicles sold fewer times, but produced strong profit. These outcomes should be watched and opportunistically repeated.
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[280px] text-xs leading-relaxed">
                <p className="font-medium mb-1">How these are identified</p>
                <ul className="list-disc pl-3.5 space-y-0.5">
                  <li>Only includes vehicles sold 1–2 times</li>
                  <li>Excluded from your top-selling models</li>
                  <li>Outcome metrics (clearance speed or sale price) are significantly above your overall median</li>
                  <li>Low-frequency results don't appear in volume charts, but may still represent repeatable opportunity</li>
                </ul>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((w, i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-muted/20 p-4 space-y-2"
            >
              {/* Vehicle identity */}
              <div>
                <p className="font-semibold text-sm">
                  {w.make} {w.model} {w.year ?? ""}
                </p>
                {w.variant && (
                  <p className="text-xs text-muted-foreground">{w.variant}</p>
                )}
              </div>

              {/* Metrics row */}
              <div className="flex flex-wrap gap-2 text-xs">
                {w.profitDollars != null && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Percent className="h-3 w-3" />
                    ${Math.abs(w.profitDollars).toLocaleString()} {w.profitDollars >= 0 ? "margin" : "below cost"}
                  </span>
                )}
                {w.daysToClear != null && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Zap className="h-3 w-3" />
                    Cleared in {formatDays(w.daysToClear)}
                  </span>
                )}
                {w.salePrice != null && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <TrendingUp className="h-3 w-3" />
                    {formatPrice(w.salePrice)}
                  </span>
                )}
                {w.km != null && (
                  <span className="text-muted-foreground">
                    {w.km.toLocaleString()} km
                  </span>
                )}
              </div>

              {/* Badges */}
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-xs bg-accent/10 text-accent-foreground border-accent/20">
                  Outcome fingerprint — low frequency, high signal
                </Badge>
                {w.clearanceRatio != null && w.clearanceRatio <= 0.6 && (
                  <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                    Fast clearance
                  </Badge>
                )}
                {w.priceRatio != null && w.priceRatio >= 1.3 && (
                  <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                    Strong outcome
                  </Badge>
                )}
                {w.profitDollars != null && w.profitDollars >= 5000 && (
                  <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                    Higher capital efficiency
                  </Badge>
                )}
              </div>

              {/* Reasons */}
              <div className="space-y-0.5">
                {w.reasons.map((r, j) => (
                  <p key={j} className="text-xs text-muted-foreground italic">
                    {r}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
