import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { 
  Bell, ExternalLink, Target, Eye, CheckCircle, AlertTriangle, 
  TrendingUp, Clock, Info, ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';
import { KitingWingMarkVideo } from '@/components/kiting';
import { parseHuntAlertPayload, type HuntAlertPayload } from '@/types/hunts';

interface UnifiedAlert {
  id: string;
  type: 'BUY' | 'WATCH';
  source: string;
  year: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  km: number | null;
  asking_price: number | null;
  proven_exit: number | null;
  gap_dollars: number | null;
  gap_pct: number | null;
  match_score: number | null;
  listing_url: string | null;
  state: string | null;
  suburb: string | null;
  reasons: string[];
  created_at: string;
  acknowledged_at: string | null;
  origin: 'hunt' | 'trigger';
  hunt_id?: string;
  raw_payload?: unknown;
}

export default function UnifiedAlertsPage() {
  const { isAdmin } = useAuth();
  const [alerts, setAlerts] = useState<UnifiedAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState<UnifiedAlert | null>(null);
  const [activeTab, setActiveTab] = useState<'buy' | 'watch' | 'all'>('buy');

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    setIsLoading(true);
    try {
      // Fetch hunt_alerts
      const { data: huntAlerts, error } = await supabase
        .from('hunt_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      // Map to unified format
      const unified: UnifiedAlert[] = (huntAlerts || []).map(ha => {
        const parsed = parseHuntAlertPayload(ha.payload);
        const payload: HuntAlertPayload = parsed.success ? parsed.data : {};
        
        return {
          id: ha.id,
          type: ha.alert_type as 'BUY' | 'WATCH',
          source: payload.source || 'unknown',
          year: payload.year ?? null,
          make: payload.make ?? null,
          model: payload.model ?? null,
          variant: payload.variant ?? null,
          km: payload.km ?? null,
          asking_price: payload.asking_price ?? null,
          proven_exit: payload.proven_exit_value ?? null,
          gap_dollars: payload.gap_dollars ?? null,
          gap_pct: payload.gap_pct ?? null,
          match_score: payload.match_score ?? null,
          listing_url: payload.listing_url ?? null,
          state: payload.state ?? null,
          suburb: payload.suburb ?? null,
          reasons: payload.reasons || [],
          created_at: ha.created_at,
          acknowledged_at: ha.acknowledged_at,
          origin: 'hunt',
          hunt_id: ha.hunt_id,
          raw_payload: ha.payload,
        };
      });

      setAlerts(unified);
    } catch (err) {
      console.error('Failed to load alerts:', err);
      toast.error('Failed to load alerts');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAcknowledge = async (alertId: string) => {
    try {
      await supabase
        .from('hunt_alerts')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('id', alertId);
      
      toast.success('Alert acknowledged');
      await loadAlerts();
    } catch (err) {
      console.error('Failed to acknowledge:', err);
      toast.error('Failed to acknowledge');
    }
  };

  const filteredAlerts = alerts.filter(a => {
    if (activeTab === 'buy') return a.type === 'BUY';
    if (activeTab === 'watch') return a.type === 'WATCH';
    return true;
  });

  const buyCount = alerts.filter(a => a.type === 'BUY' && !a.acknowledged_at).length;
  const watchCount = alerts.filter(a => a.type === 'WATCH' && !a.acknowledged_at).length;

  const getSourceBadge = (source: string) => {
    const isPrivate = source.includes('private');
    return (
      <Badge 
        variant="outline" 
        className={`text-xs ${isPrivate ? 'border-yellow-500/50 text-yellow-500' : ''}`}
      >
        {isPrivate && <AlertTriangle className="w-3 h-3 mr-1" />}
        {source}
      </Badge>
    );
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <KitingWingMarkVideo size={48} />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Alerts Inbox</h1>
            <p className="text-muted-foreground mt-1">
              Unified view of Kiting Mode BUY and WATCH alerts
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card className={buyCount > 0 ? 'border-green-500/50 bg-green-500/5' : ''}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5">
                <Target className="w-4 h-4 text-green-500" />
                BUY Alerts
              </CardDescription>
              <CardTitle className="text-2xl text-green-500">{buyCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card className={watchCount > 0 ? 'border-yellow-500/50 bg-yellow-500/5' : ''}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-yellow-500" />
                WATCH Alerts
              </CardDescription>
              <CardTitle className="text-2xl text-yellow-500">{watchCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total (24h)</CardDescription>
              <CardTitle className="text-2xl">{alerts.length}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'buy' | 'watch' | 'all')}>
          <TabsList>
            <TabsTrigger value="buy" className="gap-1.5">
              <Target className="w-4 h-4" />
              BUY ({alerts.filter(a => a.type === 'BUY').length})
            </TabsTrigger>
            <TabsTrigger value="watch" className="gap-1.5">
              <Eye className="w-4 h-4" />
              WATCH ({alerts.filter(a => a.type === 'WATCH').length})
            </TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4">
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
                ))}
              </div>
            ) : filteredAlerts.length === 0 ? (
              <div className="bg-card border border-border rounded-lg p-12 text-center">
                <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  No {activeTab === 'all' ? '' : activeTab.toUpperCase()} alerts yet
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredAlerts.map(alert => (
                  <Card 
                    key={alert.id}
                    className={`cursor-pointer transition-all hover:border-primary/50 ${
                      alert.type === 'BUY' ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-yellow-500'
                    } ${alert.acknowledged_at ? 'opacity-60' : ''}`}
                    onClick={() => setSelectedAlert(alert)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant={alert.type === 'BUY' ? 'default' : 'secondary'} className={
                              alert.type === 'BUY' ? 'bg-green-600' : 'bg-yellow-600'
                            }>
                              {alert.type === 'BUY' ? <Target className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
                              {alert.type}
                            </Badge>
                            {getSourceBadge(alert.source)}
                            {alert.acknowledged_at && (
                              <CheckCircle className="w-4 h-4 text-muted-foreground" />
                            )}
                          </div>
                          
                          <h3 className="font-semibold text-foreground">
                            {alert.year} {alert.make} {alert.model} {alert.variant && <span className="text-muted-foreground font-normal">{alert.variant}</span>}
                          </h3>
                          
                          <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
                            {alert.km && <span>{(alert.km / 1000).toFixed(0)}k km</span>}
                            {(alert.state || alert.suburb) && (
                              <span>{[alert.suburb, alert.state].filter(Boolean).join(', ')}</span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {format(new Date(alert.created_at), 'dd MMM HH:mm')}
                            </span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          {alert.asking_price && (
                            <div className="font-semibold">${alert.asking_price.toLocaleString()}</div>
                          )}
                          {alert.gap_dollars && alert.gap_pct && (
                            <div className={`text-sm font-medium ${alert.type === 'BUY' ? 'text-green-500' : 'text-yellow-500'}`}>
                              +${alert.gap_dollars.toLocaleString()} ({alert.gap_pct.toFixed(1)}%)
                            </div>
                          )}
                          {alert.match_score && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Score: {alert.match_score.toFixed(1)}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Detail Drawer */}
        <Drawer open={!!selectedAlert} onOpenChange={(open) => !open && setSelectedAlert(null)}>
          <DrawerContent>
            {selectedAlert && (
              <div className="mx-auto w-full max-w-lg p-6">
                <DrawerHeader className="px-0">
                  <DrawerTitle className="flex items-center gap-2">
                    {selectedAlert.type === 'BUY' ? (
                      <Target className="w-5 h-5 text-green-500" />
                    ) : (
                      <Eye className="w-5 h-5 text-yellow-500" />
                    )}
                    {selectedAlert.type} Alert Details
                  </DrawerTitle>
                  <DrawerDescription>
                    {selectedAlert.year} {selectedAlert.make} {selectedAlert.model}
                  </DrawerDescription>
                </DrawerHeader>

                <div className="space-y-6">
                  {/* Vehicle Info */}
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">Vehicle</h4>
                    <div className="bg-muted/50 rounded-lg p-4">
                      <p className="font-semibold text-lg">
                        {selectedAlert.year} {selectedAlert.make} {selectedAlert.model}
                        {selectedAlert.variant && <span className="text-muted-foreground font-normal"> {selectedAlert.variant}</span>}
                      </p>
                      <div className="flex flex-wrap gap-3 mt-2 text-sm text-muted-foreground">
                        {selectedAlert.km && <span>{(selectedAlert.km / 1000).toFixed(0)}k km</span>}
                        {getSourceBadge(selectedAlert.source)}
                        {(selectedAlert.state || selectedAlert.suburb) && (
                          <span>{[selectedAlert.suburb, selectedAlert.state].filter(Boolean).join(', ')}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Pricing */}
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">Pricing Analysis</h4>
                    <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Asking Price</span>
                        <span className="font-semibold">
                          {selectedAlert.asking_price ? `$${selectedAlert.asking_price.toLocaleString()}` : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Proven Exit</span>
                        <span className="font-semibold">
                          {selectedAlert.proven_exit ? `$${selectedAlert.proven_exit.toLocaleString()}` : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-border">
                        <span className="text-muted-foreground">Gap</span>
                        <span className={`font-bold ${selectedAlert.type === 'BUY' ? 'text-green-500' : 'text-yellow-500'}`}>
                          {selectedAlert.gap_dollars ? `+$${selectedAlert.gap_dollars.toLocaleString()}` : '—'}
                          {selectedAlert.gap_pct ? ` (${selectedAlert.gap_pct.toFixed(1)}%)` : ''}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Match Reasons */}
                  {selectedAlert.reasons.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2">Why This Matched</h4>
                      <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                        {selectedAlert.reasons.map((reason, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm">
                            <ShieldCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                            <span>{reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Private Seller Warning */}
                  {selectedAlert.source.includes('private') && (
                    <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                      <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0" />
                      <div className="text-sm">
                        <p className="font-medium text-yellow-500">Private Seller</p>
                        <p className="text-muted-foreground">Verify listing details manually before proceeding</p>
                      </div>
                    </div>
                  )}

                  {/* Admin: Raw Payload */}
                  {isAdmin && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Raw Payload (Admin)</summary>
                      <pre className="mt-2 p-3 bg-muted rounded overflow-auto max-h-48">
                        {JSON.stringify(selectedAlert.raw_payload, null, 2)}
                      </pre>
                    </details>
                  )}

                  {/* Actions */}
                  <div className="flex gap-3 pt-4">
                    {selectedAlert.listing_url && (
                      <Button className="flex-1" onClick={() => window.open(selectedAlert.listing_url!, '_blank')}>
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Open Listing
                      </Button>
                    )}
                    {!selectedAlert.acknowledged_at && (
                      <Button 
                        variant="secondary" 
                        onClick={() => {
                          handleAcknowledge(selectedAlert.id);
                          setSelectedAlert(null);
                        }}
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Acknowledge
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </DrawerContent>
        </Drawer>
      </div>
    </AppLayout>
  );
}
