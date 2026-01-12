import { format, formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Sparkles, AlertTriangle, RotateCw, Activity, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePresenceStats } from '@/hooks/usePresenceStats';

export function PresenceStatsCard() {
  const { stats, loading } = usePresenceStats();

  if (loading) {
    return (
      <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg border border-border animate-pulse">
        <div className="h-4 w-32 bg-muted rounded" />
        <div className="h-4 w-24 bg-muted rounded" />
        <div className="h-4 w-24 bg-muted rounded" />
      </div>
    );
  }

  if (!stats.runId) {
    return (
      <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg border border-border text-sm text-muted-foreground">
        <Clock className="h-4 w-4" />
        No pipeline runs yet
      </div>
    );
  }

  const runTimeAgo = stats.runDate 
    ? formatDistanceToNow(new Date(stats.runDate), { addSuffix: true })
    : 'unknown';

  return (
    <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg border border-border">
      {/* Last Run Info */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="h-4 w-4" />
        <span>Last pipeline: {runTimeAgo}</span>
        <Badge 
          variant="outline" 
          className={cn(
            'text-xs',
            stats.runStatus === 'SUCCESS' 
              ? 'bg-green-500/10 text-green-600 border-green-500/30'
              : 'bg-amber-500/10 text-amber-600 border-amber-500/30'
          )}
        >
          {stats.runStatus}
        </Badge>
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Presence Stats */}
      <div className="flex items-center gap-3">
        <Badge 
          variant="outline" 
          className="bg-green-500/10 text-green-600 border-green-500/30 gap-1"
        >
          <Sparkles className="h-3 w-3" />
          {stats.newToday} new
        </Badge>

        <Badge 
          variant="outline" 
          className="bg-amber-500/10 text-amber-600 border-amber-500/30 gap-1"
        >
          <AlertTriangle className="h-3 w-3" />
          {stats.missingToday} missing
        </Badge>

        <Badge 
          variant="outline" 
          className="bg-purple-500/10 text-purple-600 border-purple-500/30 gap-1"
        >
          <RotateCw className="h-3 w-3" />
          {stats.returnedToday} returned
        </Badge>

        <Badge 
          variant="outline" 
          className="bg-blue-500/10 text-blue-600 border-blue-500/30 gap-1"
        >
          <Activity className="h-3 w-3" />
          {stats.stillActive} active
        </Badge>
      </div>
    </div>
  );
}
