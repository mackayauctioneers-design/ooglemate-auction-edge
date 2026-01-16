import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { parseHuntAlertPayload } from '@/types/hunts';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { 
  Bell, 
  CheckCircle, 
  ExternalLink, 
  Eye,
  ChevronRight,
  Loader2,
  CheckCheck,
  Target
} from 'lucide-react';
import { toast } from 'sonner';

interface HuntAlertItem {
  id: string;
  hunt_id: string;
  alert_type: 'BUY' | 'WATCH';
  created_at: string;
  acknowledged_at: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  asking_price: number | null;
  gap_dollars: number | null;
  gap_pct: number | null;
  source: string | null;
  listing_url: string | null;
}

interface NotificationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}

export function NotificationDrawer({ open, onOpenChange, onRefresh }: NotificationDrawerProps) {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [huntAlerts, setHuntAlerts] = useState<HuntAlertItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'buy' | 'watch'>('buy');

  const loadHuntAlerts = async () => {
    setIsLoading(true);
    try {
      // Fetch hunt_alerts from Supabase
      const { data, error } = await supabase
        .from('hunt_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Parse payloads
      const parsed: HuntAlertItem[] = (data || []).map(row => {
        const result = parseHuntAlertPayload(row.payload);
        const payload = result.success ? result.data : {};
        
        return {
          id: row.id,
          hunt_id: row.hunt_id,
          alert_type: row.alert_type as 'BUY' | 'WATCH',
          created_at: row.created_at,
          acknowledged_at: row.acknowledged_at,
          year: payload.year ?? null,
          make: payload.make ?? null,
          model: payload.model ?? null,
          variant: payload.variant ?? null,
          asking_price: payload.asking_price ?? null,
          gap_dollars: payload.gap_dollars ?? null,
          gap_pct: payload.gap_pct ?? null,
          source: payload.source ?? null,
          listing_url: payload.listing_url ?? null,
        };
      });

      setHuntAlerts(parsed);
    } catch (error) {
      console.error('Failed to load hunt alerts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadHuntAlerts();
    }
  }, [open]);

  const handleAcknowledge = async (alertId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await supabase
        .from('hunt_alerts')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('id', alertId);
      
      await loadHuntAlerts();
      onRefresh();
      toast.success('Alert acknowledged');
    } catch (error) {
      console.error('Failed to acknowledge:', error);
      toast.error('Failed to update');
    }
  };

  const handleMarkAllAcknowledged = async () => {
    try {
      const unackIds = huntAlerts
        .filter(a => !a.acknowledged_at && a.alert_type === (activeTab === 'buy' ? 'BUY' : 'WATCH'))
        .map(a => a.id);
      
      if (unackIds.length === 0) return;
      
      await supabase
        .from('hunt_alerts')
        .update({ acknowledged_at: new Date().toISOString() })
        .in('id', unackIds);
      
      await loadHuntAlerts();
      onRefresh();
      toast.success(`Acknowledged ${unackIds.length} alerts`);
    } catch (error) {
      console.error('Failed to mark all:', error);
      toast.error('Failed to update');
    }
  };

  const handleOpenListing = (url: string | null, e: React.MouseEvent) => {
    e.stopPropagation();
    if (url) {
      window.open(url, '_blank');
    }
  };

  const handleViewHunt = (huntId: string) => {
    onOpenChange(false);
    navigate(`/hunts/${huntId}`);
  };

  const handleViewAll = () => {
    onOpenChange(false);
    navigate('/alerts');
  };

  const buyAlerts = huntAlerts.filter(a => a.alert_type === 'BUY');
  const watchAlerts = huntAlerts.filter(a => a.alert_type === 'WATCH');
  const currentAlerts = activeTab === 'buy' ? buyAlerts : watchAlerts;
  
  const unackBuyCount = buyAlerts.filter(a => !a.acknowledged_at).length;
  const unackWatchCount = watchAlerts.filter(a => !a.acknowledged_at).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0">
        <SheetHeader className="p-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Kiting Mode Alerts
          </SheetTitle>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'buy' | 'watch')} className="flex flex-col h-[calc(100vh-8rem)]">
          <TabsList className="mx-4 mt-2">
            <TabsTrigger value="buy" className="flex-1 gap-1">
              <Target className="h-3.5 w-3.5" />
              BUY
              {unackBuyCount > 0 && (
                <Badge variant="default" className="ml-1 h-5 min-w-5 px-1.5 bg-green-600">
                  {unackBuyCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="watch" className="flex-1 gap-1">
              <Eye className="h-3.5 w-3.5" />
              WATCH
              {unackWatchCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">
                  {unackWatchCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {(activeTab === 'buy' ? unackBuyCount : unackWatchCount) > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mx-4 mt-2 justify-start"
              onClick={handleMarkAllAcknowledged}
            >
              <CheckCheck className="h-4 w-4 mr-1" />
              Acknowledge all {activeTab.toUpperCase()}
            </Button>
          )}

          <ScrollArea className="flex-1">
            <TabsContent value={activeTab} className="mt-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : currentAlerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  {activeTab === 'buy' ? (
                    <Target className="h-10 w-10 text-muted-foreground mb-3" />
                  ) : (
                    <Eye className="h-10 w-10 text-muted-foreground mb-3" />
                  )}
                  <p className="text-sm text-muted-foreground">
                    No {activeTab.toUpperCase()} alerts yet
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Alerts appear when Kiting Mode finds matches
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {currentAlerts.map((alert) => (
                    <div 
                      key={alert.id}
                      className={`p-4 hover:bg-muted/50 transition-colors cursor-pointer ${
                        !alert.acknowledged_at ? (alert.alert_type === 'BUY' ? 'bg-green-500/5' : 'bg-yellow-500/5') : ''
                      }`}
                      onClick={() => handleViewHunt(alert.hunt_id)}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-1 ${
                          alert.alert_type === 'BUY' ? 'text-green-500' : 'text-yellow-500'
                        }`}>
                          {alert.acknowledged_at ? (
                            <CheckCircle className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Target className="h-4 w-4" />
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge 
                              variant={alert.alert_type === 'BUY' ? 'default' : 'secondary'}
                              className={alert.alert_type === 'BUY' ? 'bg-green-600' : 'bg-yellow-600'}
                            >
                              {alert.alert_type}
                            </Badge>
                            {!alert.acknowledged_at && (
                              <span className={`text-xs font-medium ${
                                alert.alert_type === 'BUY' ? 'text-green-500' : 'text-yellow-500'
                              }`}>
                                New
                              </span>
                            )}
                            {alert.source && (
                              <Badge variant="outline" className="text-[10px]">
                                {alert.source}
                              </Badge>
                            )}
                          </div>
                          
                          <p className="font-medium text-sm mt-1 truncate">
                            {alert.year} {alert.make} {alert.model}
                            {alert.variant && <span className="text-muted-foreground font-normal"> {alert.variant}</span>}
                          </p>
                          
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            {alert.asking_price && (
                              <span>${alert.asking_price.toLocaleString()}</span>
                            )}
                            {alert.gap_dollars && alert.gap_pct && (
                              <span className={alert.alert_type === 'BUY' ? 'text-green-500 font-medium' : 'text-yellow-500 font-medium'}>
                                +${alert.gap_dollars.toLocaleString()} ({alert.gap_pct.toFixed(1)}%)
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 mt-3">
                            {alert.listing_url && (
                              <Button 
                                variant="outline" 
                                size="sm"
                                className="h-7 text-xs"
                                onClick={(e) => handleOpenListing(alert.listing_url, e)}
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />
                                Open
                              </Button>
                            )}
                            {!alert.acknowledged_at && (
                              <Button 
                                variant="ghost" 
                                size="sm"
                                className="h-7 text-xs"
                                onClick={(e) => handleAcknowledge(alert.id, e)}
                              >
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Ack
                              </Button>
                            )}
                          </div>

                          <p className="text-[10px] text-muted-foreground mt-2">
                            {format(new Date(alert.created_at), 'dd MMM yyyy HH:mm')}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-border bg-background">
          <Button 
            variant="outline" 
            className="w-full" 
            onClick={handleViewAll}
          >
            View All Alerts
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
