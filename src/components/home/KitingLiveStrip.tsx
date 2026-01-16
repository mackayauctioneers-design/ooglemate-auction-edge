import { Activity, Target, Search, Clock, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { KitingLive } from '@/hooks/useHomeDashboard';
import { KitingIndicator } from '@/components/kiting';
import { useKitingStateFromLive } from '@/hooks/useKitingState';

interface KitingLiveStripProps {
  data: KitingLive;
  isLoading?: boolean;
  recentAlertAt?: string | null;
}

export function KitingLiveStrip({ data, isLoading, recentAlertAt }: KitingLiveStripProps) {
  const lastScanAgo = data.last_scan_at 
    ? formatDistanceToNow(new Date(data.last_scan_at), { addSuffix: true })
    : 'Never';

  const isActive = data.active_hunts > 0;
  const hasRecentScans = data.scans_last_60m > 0;
  
  // Derive animated state from real data
  const kitingState = useKitingStateFromLive(data, recentAlertAt);

  return (
    <Card className={`border-2 ${isActive ? 'border-primary/40 bg-primary/5' : 'border-border'} transition-colors overflow-hidden`}>
      <CardContent className="py-4 px-4">
        {/* Header with animated indicator */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <KitingIndicator state={kitingState} size="lg" showLabel={true} />
          </div>
          
          {isActive && (
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
              {data.active_hunts} ACTIVE HUNT{data.active_hunts !== 1 ? 'S' : ''}
            </Badge>
          )}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Active Hunts */}
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <div>
              <p className="text-lg font-bold mono">{data.active_hunts}</p>
              <p className="text-xs text-muted-foreground">Hunts</p>
            </div>
          </div>

          {/* Scans Last 60m */}
          <div className="flex items-center gap-2">
            <Search className={`h-4 w-4 ${hasRecentScans ? 'text-blue-500' : 'text-muted-foreground'}`} />
            <div>
              <p className="text-lg font-bold mono">{data.scans_last_60m}</p>
              <p className="text-xs text-muted-foreground">Scans (60m)</p>
            </div>
          </div>

          {/* Candidates Today */}
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-orange-500" />
            <div>
              <p className="text-lg font-bold mono">{data.candidates_today.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Evaluated</p>
            </div>
          </div>

          {/* Last Scan */}
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{lastScanAgo}</p>
              <p className="text-xs text-muted-foreground">Last Scan</p>
            </div>
          </div>
        </div>

        {/* Sources row */}
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/50">
          <Zap className="h-4 w-4 text-yellow-500" />
          <span className="text-xs text-muted-foreground">Scanning:</span>
          <div className="flex flex-wrap gap-1">
            {data.sources.map(source => (
              <Badge key={source} variant="secondary" className="text-[10px] px-1.5 py-0">
                {source.replace('_', ' ')}
              </Badge>
            ))}
          </div>
        </div>

        {/* System status */}
        {!isActive && (
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Log a sale to activate Kiting Mode and start hunting.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
