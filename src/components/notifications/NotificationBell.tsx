import { useState, useEffect } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { NotificationDrawer } from './NotificationDrawer';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';

export function NotificationBell() {
  const { isAdmin } = useAuth();
  const isMobile = useIsMobile();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  // Update browser tab title
  useDocumentTitle(unreadCount);

  const loadUnreadCount = async () => {
    try {
      // Count unacknowledged BUY alerts from hunt_alerts
      const { count, error } = await supabase
        .from('hunt_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('alert_type', 'BUY')
        .is('acknowledged_at', null);
      
      if (error) throw error;
      setUnreadCount(count || 0);
    } catch (error) {
      console.error('Failed to load unread count:', error);
    }
  };

  useEffect(() => {
    loadUnreadCount();
    // Disable polling on mobile to prevent iOS memory crashes
    if (isMobile) return;
    const interval = setInterval(loadUnreadCount, 60000);
    return () => clearInterval(interval);
  }, [isMobile]);

  const handleDrawerClose = () => {
    setIsDrawerOpen(false);
    loadUnreadCount(); // Refresh count after drawer closes
  };

  const handleMarkAllRead = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMarkingAll(true);
    try {
      const { error } = await supabase
        .from('hunt_alerts')
        .update({ acknowledged_at: new Date().toISOString() })
        .eq('alert_type', 'BUY')
        .is('acknowledged_at', null);
      
      if (error) throw error;
      
      setUnreadCount(0);
      toast.success('All BUY alerts acknowledged');
    } catch (error) {
      console.error('Failed to mark all as read:', error);
      toast.error('Failed to acknowledge alerts');
    } finally {
      setIsMarkingAll(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="iconSm"
          className="relative text-muted-foreground hover:text-foreground"
          onClick={() => setIsDrawerOpen(true)}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-action-buy text-[10px] font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
        
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="iconSm"
            className="text-muted-foreground hover:text-foreground"
            onClick={handleMarkAllRead}
            disabled={isMarkingAll}
            title="Mark all BUY alerts as read"
          >
            <CheckCheck className="h-4 w-4" />
          </Button>
        )}
      </div>

      <NotificationDrawer 
        open={isDrawerOpen} 
        onOpenChange={handleDrawerClose}
        onRefresh={loadUnreadCount}
      />
    </>
  );
}
