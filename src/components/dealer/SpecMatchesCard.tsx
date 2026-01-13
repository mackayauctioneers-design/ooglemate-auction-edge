import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { 
  Target, 
  ExternalLink, 
  TrendingDown, 
  AlertCircle,
  CheckCircle2,
  Car
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

interface MatchAlert {
  id: string;
  listing_uuid: string;
  match_type: string;
  match_score: number | null;
  benchmark_price: number | null;
  asking_price: number | null;
  delta_pct: number | null;
  make: string | null;
  model: string | null;
  variant_used: string | null;
  year: number | null;
  km: number | null;
  region_id: string | null;
  source: string | null;
  source_class: string | null;
  listing_url: string | null;
  status: string;
  claimed_by: string | null;
  created_at: string;
}

function MatchTypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; className: string; icon: React.ElementType }> = {
    UNDER_BENCHMARK: {
      label: 'Under Market',
      className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
      icon: TrendingDown,
    },
    BUY_WINDOW_MATCH: {
      label: 'Buy Window',
      className: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
      icon: Target,
    },
    SPEC_MATCH: {
      label: 'Spec Match',
      className: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
      icon: Car,
    },
  };

  const { label, className, icon: Icon } = config[type] || config.SPEC_MATCH;

  return (
    <Badge variant="outline" className={`gap-1 ${className}`}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function formatPrice(price: number | null): string {
  if (price === null) return '—';
  return `$${price.toLocaleString()}`;
}

function formatKm(km: number | null): string {
  if (km === null) return '—';
  return `${(km / 1000).toFixed(0)}k km`;
}

interface SpecMatchesCardProps {
  dealerId?: string;
  limit?: number;
  showAll?: boolean;
}

export function SpecMatchesCard({ dealerId, limit = 10, showAll = false }: SpecMatchesCardProps) {
  const [alerts, setAlerts] = useState<MatchAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAlerts();
  }, [dealerId]);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('dealer_match_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (dealerId) {
        query = query.eq('dealer_id', dealerId);
      }

      if (!showAll) {
        query = query.eq('status', 'new');
      }

      const { data, error } = await query;

      if (error) throw error;
      setAlerts((data as MatchAlert[]) || []);
    } catch (error) {
      console.error('Error fetching spec matches:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async (alertId: string, claimBy: string) => {
    try {
      const { error } = await supabase
        .from('dealer_match_alerts')
        .update({ 
          status: 'claimed', 
          claimed_by: claimBy,
          claimed_at: new Date().toISOString()
        })
        .eq('id', alertId);

      if (error) throw error;
      toast.success(`Claimed by ${claimBy}`);
      fetchAlerts();
    } catch (error) {
      console.error('Error claiming alert:', error);
      toast.error('Failed to claim');
    }
  };

  const handleDismiss = async (alertId: string) => {
    try {
      const { error } = await supabase
        .from('dealer_match_alerts')
        .update({ status: 'dismissed' })
        .eq('id', alertId);

      if (error) throw error;
      toast.success('Alert dismissed');
      fetchAlerts();
    } catch (error) {
      console.error('Error dismissing alert:', error);
      toast.error('Failed to dismiss');
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Spec Matches</CardTitle>
          {alerts.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {alerts.length}
            </Badge>
          )}
        </div>
        <CardDescription>
          Listings matching your buy specs
        </CardDescription>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No matching listings found</p>
            <p className="text-xs mt-1">Configure specs to get alerts</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="p-3 rounded-lg border border-border/60 bg-card hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">
                          {alert.year} {alert.make} {alert.model}
                        </span>
                        <MatchTypeBadge type={alert.match_type} />
                      </div>
                      
                      {alert.variant_used && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {alert.variant_used}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span>{formatKm(alert.km)}</span>
                        <span>{formatPrice(alert.asking_price)}</span>
                        {alert.delta_pct !== null && (
                          <span className={alert.delta_pct < 0 ? 'text-emerald-600' : 'text-red-600'}>
                            {alert.delta_pct > 0 ? '+' : ''}{alert.delta_pct.toFixed(1)}%
                          </span>
                        )}
                        <span className="capitalize">{alert.source_class}</span>
                      </div>
                      
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    
                    <div className="flex flex-col gap-1">
                      {alert.listing_url && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => window.open(alert.listing_url!, '_blank')}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {alert.status === 'new' && (
                    <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border/40">
                      <Button
                        variant="default"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleClaim(alert.id, 'Dave')}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Dave
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleClaim(alert.id, 'VA')}
                      >
                        VA
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs ml-auto"
                        onClick={() => handleDismiss(alert.id)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}
                  
                  {alert.status === 'claimed' && alert.claimed_by && (
                    <div className="mt-2 pt-2 border-t border-border/40">
                      <Badge variant="outline" className="text-xs">
                        Claimed by {alert.claimed_by}
                      </Badge>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
