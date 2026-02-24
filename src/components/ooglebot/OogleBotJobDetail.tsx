import { useOogleBotJobs, useOogleBotMatches } from "@/hooks/useOogleBot";
import { Badge } from "@/components/ui/badge";
import { Loader2, ExternalLink, Bot, MapPin } from "lucide-react";

interface Props {
  jobId: string | null;
}

export function OogleBotJobDetail({ jobId }: Props) {
  const { data: jobs } = useOogleBotJobs();
  const { data: matches, isLoading } = useOogleBotMatches(jobId);

  const job = jobs?.find((j) => j.id === jobId);

  if (!jobId || !job) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-muted-foreground sticky top-6">
        <Bot className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
        <p>Select a job to view matches</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card sticky top-6">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold text-foreground">
          {job.make} {job.model} {job.variant || ""}
        </h3>
        <p className="text-sm text-muted-foreground">
          For {job.dealer_name} · Budget ${job.budget_ceiling.toLocaleString()}
        </p>
      </div>

      <div className="p-4 space-y-3">
        <h4 className="text-sm font-medium text-foreground">Top 3 Matches</h4>

        {isLoading && (
          <div className="flex justify-center p-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && (!matches || matches.length === 0) && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No matches found yet. Run the scanner to populate.
          </p>
        )}

        {matches?.map((m) => (
          <div key={m.id} className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-xs">
                Rank #{m.rank_position}
              </Badge>
              <span className="font-mono text-sm font-semibold text-foreground">
                ${m.effective_cost?.toLocaleString()}
              </span>
            </div>

            <div className="text-sm text-foreground">
              {m.year} {m.make} {m.model} {m.variant || ""}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {m.ask_price && <span>Ask: ${m.ask_price.toLocaleString()}</span>}
              {m.km && <span>{(m.km / 1000).toFixed(0)}k km</span>}
              {m.days_listed != null && <span>{m.days_listed}d listed</span>}
              <span className="capitalize">{m.source}</span>
            </div>

            {m.location && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {m.location}
              </div>
            )}

            {m.listing_url && (
              <a
                href={m.listing_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                View listing
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
