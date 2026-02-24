import { useOogleBotJobs, useUpdateJobStatus } from "@/hooks/useOogleBot";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle, Pause, XCircle, Eye, Loader2 } from "lucide-react";
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

export function OogleBotJobList({ selectedJobId, onSelectJob }: Props) {
  const { data: jobs, isLoading } = useOogleBotJobs();
  const updateStatus = useUpdateJobStatus();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!jobs?.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        No OogleBot jobs yet. Create one above.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="p-4 border-b border-border">
        <h2 className="font-semibold text-foreground">Active Jobs</h2>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Dealer</TableHead>
            <TableHead>Vehicle</TableHead>
            <TableHead>Budget</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow
              key={job.id}
              className={cn(
                "cursor-pointer",
                selectedJobId === job.id && "bg-primary/5"
              )}
              onClick={() => onSelectJob(job.id)}
            >
              <TableCell>
                <div className="font-medium text-foreground">{job.dealer_name}</div>
                <Badge className={cn("mt-1 text-xs", urgencyColors[job.urgency])}>
                  {job.urgency}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="text-foreground">
                  {job.make} {job.model} {job.variant || ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {job.year_min}–{job.year_max} · ≤{(job.km_max / 1000).toFixed(0)}k km
                </div>
              </TableCell>
              <TableCell className="font-mono text-foreground">
                ${job.budget_ceiling.toLocaleString()}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {formatDistanceToNow(new Date(job.expiry_date), { addSuffix: true })}
              </TableCell>
              <TableCell>
                <Badge className={cn(statusColors[job.status])}>{job.status}</Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    title="View matches"
                    onClick={() => onSelectJob(job.id)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  {job.status === "active" && (
                    <>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        title="Mark fulfilled"
                        onClick={() => updateStatus.mutate({ id: job.id, status: "fulfilled" })}
                      >
                        <CheckCircle className="h-4 w-4 text-green-400" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        title="Pause"
                        onClick={() => updateStatus.mutate({ id: job.id, status: "paused" })}
                      >
                        <Pause className="h-4 w-4 text-yellow-400" />
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
                      <CheckCircle className="h-4 w-4 text-primary" />
                    </Button>
                  )}
                  {(job.status === "active" || job.status === "paused") && (
                    <Button
                      variant="ghost"
                      size="iconSm"
                      title="Cancel (expire)"
                      onClick={() => updateStatus.mutate({ id: job.id, status: "expired" })}
                    >
                      <XCircle className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
