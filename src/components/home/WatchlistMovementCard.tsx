import { Clock, TrendingDown, AlertCircle, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { WatchlistItem } from '@/hooks/useHomeDashboard';
import { formatDistanceToNow } from 'date-fns';

interface WatchlistMovementCardProps {
  items: WatchlistItem[];
}

export function WatchlistMovementCard({ items }: WatchlistMovementCardProps) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Watchlist Movement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No active watch items. BUY signals will appear here when they're close to strike threshold.
          </p>
        </CardContent>
      </Card>
    );
  }

  const staleCount = items.filter(i => i.status === 'STALE').length;
  const activeItems = items.filter(i => i.status !== 'STALE');
  const staleItems = items.filter(i => i.status === 'STALE');

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Watchlist Movement
          </CardTitle>
          {staleCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {staleCount} stale
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Active watches first */}
        {activeItems.map((item) => (
          <WatchlistItemRow key={item.listing_id} item={item} />
        ))}
        
        {/* Stale items with visual separation */}
        {staleItems.length > 0 && activeItems.length > 0 && (
          <div className="border-t pt-2 mt-2">
            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Stale watches (no movement 7+ days)
            </p>
          </div>
        )}
        {staleItems.map((item) => (
          <WatchlistItemRow key={item.listing_id} item={item} isStale />
        ))}
      </CardContent>
    </Card>
  );
}

function WatchlistItemRow({ item, isStale = false }: { item: WatchlistItem; isStale?: boolean }) {
  const lastSeenAgo = item.last_seen_at 
    ? formatDistanceToNow(new Date(item.last_seen_at), { addSuffix: true })
    : 'Unknown';

  return (
    <div className={`flex items-center justify-between p-2 rounded-lg ${isStale ? 'bg-muted/20 opacity-60' : 'bg-muted/40'}`}>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isStale ? 'text-muted-foreground' : ''}`}>
          {item.title}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{item.source || 'unknown'}</span>
          <span>•</span>
          <span>{lastSeenAgo}</span>
          {item.age_days > 0 && (
            <>
              <span>•</span>
              <span>{item.age_days}d old</span>
            </>
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        {/* Gap to strike */}
        {item.gap_pct != null && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Gap</p>
            <p className={`text-sm font-medium mono ${item.gap_pct >= 8 ? 'text-green-600' : item.gap_pct >= 5 ? 'text-yellow-600' : 'text-muted-foreground'}`}>
              {item.gap_pct > 0 ? `+${item.gap_pct.toFixed(1)}%` : `${item.gap_pct.toFixed(1)}%`}
            </p>
          </div>
        )}
        
        {isStale && (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            STALE
          </Badge>
        )}
      </div>
    </div>
  );
}
