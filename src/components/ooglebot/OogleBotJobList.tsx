import { useEffect } from "react";
import { useOogleBotJobs, useOogleBotMatches, useUpdateJobStatus } from "@/hooks/useOogleBot";
import { useStarVehicle } from "@/hooks/useStarVehicle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle,
  Pause,
  XCircle,
  ChevronDown,
  Loader2,
  ExternalLink,
  MapPin,
  Star,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  selectedJobId: string | null;
  onSelectJob: (id: string | null) => void;
}

const urgencyColors: Record<string, string> = {
  normal: "bg-muted text-muted-foreground",
  high: "bg-yellow-500/20 text-yellow-400",
  urgent: "bg-destructive/20 text-destructive",
};

const statusColors: Record<string, string> = {
  active: "bg-primary/20 text-primary",
  fulfilled: "bg-green-500/20 text-green-400",
  expired: "bg-muted text-muted-foreground",
  paused: "bg-yellow-500/20 text-yellow-400",
};

function JobMatchesPanel({ jobId }: { jobId: string }) {
  const { data: matches, isLoading } = useOogleBotMatches(jobId);
  const { toggleStar, isStarred, isLoading: isStarLoading, checkStarred } = useStarVehicle();

  useEffect(() => {
    if (matches?.length) {
      checkStarred(matches.map((m) => m.listing_id));
    }
  }, [matches, checkStarred]);

  if (isLoading) {
    return (
      <div className="flex justify-center p-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!matches?.length) {
    return (
      <p className="text-xs text-muted-foreground px-4 py-3">
        No matches yet — waiting for next scan cycle.
      </p>
    );
  }

  return (
    <div className="px-4 pb-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Top 3 cheapest nationally</p>
      {matches.map((m) => (
        <div
          key={m.id}
          className="rounded-md border border-border bg-muted/20 p-2.5 space-y-1.5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                #{m.rank_position}
              </Badge>
              <span className="text-sm text-foreground">
                {m.year} {m.make} {m.model} {m.variant || ""}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sm font-semibold text-foreground">
                ${m.effective_cost?.toLocaleString()}
              </span>
              <Button
                variant="ghost"
                size="iconSm"
                onClick={() =>
                  toggleStar({
                    listing_id: m.listing_id,
                    make: m.make,
                    model: m.model,
                    year: m.year,
                    km: m.km,
                    asking_price: m.ask_price,
                    source: m.source,
                    source_url: m.listing_url,
                    variant: m.variant,
                    location: m.location,
                  })
                }
                disabled={isStarLoading(m.listing_id)}
              >
                <Star
                  className={cn(
                    "h-3.5 w-3.5",
                    isStarred(m.listing_id)
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground"
                  )}
                />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {m.ask_price && <span>Ask: ${m.ask_price.toLocaleString()}</span>}
            {m.km != null && <span>{(m.km / 1000).toFixed(0)}k km</span>}
            {m.days_listed != null && <span>{m.days_listed}d listed</span>}
            <span className="capitalize">{m.source}</span>
          </div>

          <div className="flex items-center justify-between">
            {m.location && (
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <MapPin className="h-2.5 w-2.5" />
                {m.location}
              </div>
            )}
            {m.listing_url && (
              <a
                href={m.listing_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              >
                <ExternalLink className="h-2.5 w-2.5" />
                View
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function OogleBotJobList({ selectedJobId, onSelectJob }: Props) {
  const { data: jobs, isLoading } = useOogleBotJobs();
  const updateStatus = useUpdateJobStatus();

  // Filter to show active/paused jobs, plus recently fulfilled
  const relevantJobs = jobs?.filter(
    (j) => j.status === "active" || j.status === "paused" || j.status === "fulfilled"
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!relevantJobs?.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-muted-foreground text-sm">
        No active OogleBot jobs. Create one above to start hunting.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="p-4 border-b border-border">
        <h2 className="font-semibold text-foreground text-sm">
          Active Jobs ({relevantJobs.filter((j) => j.status === "active").length})
        </h2>
      </div>

      <div className="divide-y divide-border">
        {relevantJobs.map((job) => (
          <Collapsible
            key={job.id}
            open={selectedJobId === job.id}
            onOpenChange={(open) => onSelectJob(open ? job.id : null)}
          >
            <CollapsibleTrigger asChild>
              <button className="flex items-center justify-between w-full p-3 text-left hover:bg-muted/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground truncate">
                      {job.make} {job.model} {job.variant || ""}
                    </span>
                    <Badge className={cn("text-[10px] px-1.5", urgencyColors[job.urgency])}>
                      {job.urgency}
                    </Badge>
                    <Badge className={cn("text-[10px] px-1.5", statusColors[job.status])}>
                      {job.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    <span>{job.dealer_name}</span>
                    <span className="font-mono">≤${job.budget_ceiling.toLocaleString()}</span>
                    {job.last_match_at && (
                      <span>
                        Scanned {formatDistanceToNow(new Date(job.last_match_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
                  {job.status === "active" && (
                    <>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        title="Mark fulfilled"
                        onClick={() => updateStatus.mutate({ id: job.id, status: "fulfilled" })}
                      >
                        <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        title="Pause"
                        onClick={() => updateStatus.mutate({ id: job.id, status: "paused" })}
                      >
                        <Pause className="h-3.5 w-3.5 text-yellow-400" />
                      </Button>
                    </>
                  )}
                  {job.status === "paused" && (
                    <Button
                      variant="ghost"
                      size="iconSm"
                      title="Resume"
                      onClick={() => updateStatus.mutate({ id: job.id, status: "active" })}
                    >
                      <Play className="h-3.5 w-3.5 text-primary" />
                    </Button>
                  )}
                  {(job.status === "active" || job.status === "paused") && (
                    <Button
                      variant="ghost"
                      size="iconSm"
                      title="Cancel"
                      onClick={() => updateStatus.mutate({ id: job.id, status: "expired" })}
                    >
                      <XCircle className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform cursor-pointer",
                      selectedJobId === job.id && "rotate-180"
                    )}
                    onClick={() => onSelectJob(selectedJobId === job.id ? null : job.id)}
                  />
                </div>
              </button>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="border-t border-border bg-muted/10">
                <JobMatchesPanel jobId={job.id} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    </div>
  );
}
