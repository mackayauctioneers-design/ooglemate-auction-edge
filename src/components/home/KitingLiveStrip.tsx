import { Activity, Target, Search, Clock, Zap, Radio } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { KitingLive } from '@/hooks/useHomeDashboard';

interface KitingLiveStripProps {
  data: KitingLive;
  isLoading?: boolean;
}

export function KitingLiveStrip({ data, isLoading }: KitingLiveStripProps) {
  const lastScanAgo = data.last_scan_at 
    ? formatDistanceToNow(new Date(data.last_scan_at), { addSuffix: true })
    : 'Never';

  const isActive = data.active_hunts > 0;
  const hasRecentScans = data.scans_last_60m > 0;

  return (
    <Card className={`border-2 ${isActive ? 'border-primary/40 bg-primary/5' : 'border-border'} transition-colors`}>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-2 mb-3">
          <Radio className={`h-4 w-4 ${isActive ? 'text-primary animate-pulse' : 'text-muted-foreground'}`} />
          <span className="font-semibold text-sm">Kiting Mode™ Live</span>
          {isActive && (
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
              ACTIVE
            </Badge>
          )}
          {!isActive && (
            <Badge variant="outline" className="text-xs">
              IDLE
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {/* Active Hunts */}
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <div>
              <p className="text-lg font-bold mono">{data.active_hunts}</p>
              <p className="text-xs text-muted-foreground">Active Hunts</p>
            </div>
          </div>

          {/* Scans Last 60m */}
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-blue-500" />
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
              <p className="text-xs text-muted-foreground">Evaluated Today</p>
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

          {/* Sources */}
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-500" />
            <div>
              <div className="flex flex-wrap gap-1">
                {data.sources.slice(0, 3).map(source => (
                  <Badge key={source} variant="secondary" className="text-[10px] px-1 py-0">
                    {source.replace('_', ' ')}
                  </Badge>
                ))}
                {data.sources.length > 3 && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0">
                    +{data.sources.length - 3}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Sources</p>
            </div>
          </div>
        </div>

        {/* System status message */}
        {isActive && hasRecentScans && (
          <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            System is actively hunting across {data.sources.length} sources
          </p>
        )}
        {isActive && !hasRecentScans && (
          <p className="text-xs text-muted-foreground mt-3">
            Hunts are armed. Next scan cycle pending.
          </p>
        )}
        {!isActive && (
          <p className="text-xs text-muted-foreground mt-3">
            Log a sale to activate Kiting Mode and start hunting.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
