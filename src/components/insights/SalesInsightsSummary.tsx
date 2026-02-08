import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";
import type { SummaryBullet } from "@/hooks/useSalesInsightsSummary";

interface Props {
  bullets: SummaryBullet[];
  isLoading: boolean;
  show: boolean;
}

export function SalesInsightsSummary({ bullets, isLoading, show }: Props) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            Summary from your sales history
          </CardTitle>
        </CardHeader>
        <CardContent className="h-24 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Generating summary…</p>
        </CardContent>
      </Card>
    );
  }

  if (!show) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-5 w-5" />
          Summary from your sales history
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Based on your completed sales history:
        </p>
        <ul className="space-y-2">
          {bullets.map((b) => (
            <li key={b.key} className="flex items-start gap-2 text-sm">
              <span className="text-muted-foreground mt-1 shrink-0">•</span>
              <span>{b.text}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground pt-2 border-t border-border">
          This summary reflects historical outcomes, not predictions.
        </p>
      </CardContent>
    </Card>
  );
}
