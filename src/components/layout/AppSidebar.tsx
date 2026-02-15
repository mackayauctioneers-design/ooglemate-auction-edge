import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { 
  BarChart3, 
  LogOut,
  LogIn,
  ChevronLeft,
  ChevronRight,
  Search,
  DollarSign,
  Sparkles,
  ScanLine,
  MapPin,
  Settings,
  Target,
  FileText,
  TrendingUp,
  Crosshair,
  Flame,
  Brain,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { PushNotificationPrompt } from '@/components/notifications/PushNotificationPrompt';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { AuthModal } from '@/components/auth/AuthModal';
import { useIsMobile } from '@/hooks/use-mobile';

// ============================================================================
// DEALER NAVIGATION
// ============================================================================
// Clean dealer-focused navigation. Admin items moved to Operator Mode.
// ============================================================================

// ============================================================================
// DEALER NAV: Outcomes & evidence only. Never machinery.
// Max 7 items. Dealers see what they can act on — nothing else.
// ============================================================================
const dealerNavItems = [
  { path: '/valo', label: 'Ask Bob', icon: Sparkles, highlight: true },
  { path: '/', label: "Today's Opportunities", icon: BarChart3 },
  { path: '/opportunities', label: 'Opportunities', icon: Target, authOnly: true },
  { path: '/live-alerts', label: 'Live Alerts', icon: Flame, authOnly: true },
  { path: '/scan-guide', label: 'Scan Screenshot', icon: ScanLine, authOnly: true },
  { path: '/matches-inbox', label: 'Matches Inbox', icon: Target, authOnly: true },
  { path: '/deals', label: 'Deal Ledger', icon: FileText, authOnly: true },
  { path: '/watchlist', label: 'Watchlist', icon: Search, authOnly: true },
  { path: '/sales-upload', label: 'Sales Upload', icon: DollarSign, authOnly: true },
  { path: '/sales-insights', label: 'Sales Insights', icon: TrendingUp, authOnly: true },
  { path: '/buy-again', label: 'Buy Again Targets', icon: Crosshair, authOnly: true },
  { path: '/retail-signals', label: 'Retail Signals', icon: TrendingUp, authOnly: true },
  { path: '/intelligence', label: 'Dealer Intelligence', icon: Brain, authOnly: true },
  { path: '/dealer-dashboard', label: 'My Dashboard', icon: MapPin, authOnly: true },
];

export function AppSidebar() {
  const location = useLocation();
  const { currentUser, isAdmin, logout, user, isLoading } = useAuth();
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Fetch pending job count for operator badge - disabled on mobile
  useEffect(() => {
    if (!isAdmin || isMobile) return;
    
    const fetchPendingJobs = async () => {
      const { data } = await supabase.rpc('get_job_queue_stats');
      if (data && data[0]) {
        setPendingCount(data[0].pending + data[0].processing);
      }
    };
    
    fetchPendingJobs();
    const interval = setInterval(fetchPendingJobs, 60000);
    return () => clearInterval(interval);
  }, [isAdmin, isMobile]);

  return (
    <>
      <aside 
        className={cn(
          "flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {/* Logo and Notification Bell */}
        <div className={cn(
          "flex items-center justify-between px-4 h-16 border-b border-sidebar-border",
          collapsed && "justify-center px-2"
        )}>
          <div className={cn("flex items-center gap-3", collapsed && "gap-0")}>
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground font-bold text-lg">
              C
            </div>
            {!collapsed && (
              <div>
                <h1 className="font-semibold text-foreground">Carbitrage</h1>
                <p className="text-xs text-muted-foreground">Automotive Truth</p>
              </div>
            )}
          </div>
          {!collapsed && user && <NotificationBell />}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {dealerNavItems.map(item => {
            // Skip admin-only items for non-admin users
            const isAdminOnlyItem = 'adminOnly' in item && item.adminOnly;
            if (isAdminOnlyItem && !isAdmin) return null;
            
            // Skip auth-only items for logged-out users
            const isAuthOnlyItem = 'authOnly' in item && item.authOnly;
            if (isAuthOnlyItem && !user) return null;
            
            const isActive = location.pathname === item.path;
            const isHighlight = 'highlight' in item && item.highlight;
            return (
              <Link key={item.path} to={item.path}>
                <Button
                  variant={isActive ? "navActive" : "nav"}
                  className={cn(
                    "w-full",
                    collapsed ? "justify-center px-2" : "justify-start",
                    isHighlight && !isActive && "bg-primary/10 text-primary hover:bg-primary/20"
                  )}
                >
                  <item.icon className={cn("h-4 w-4", isHighlight && !isActive && "text-primary")} />
                  {!collapsed && <span>{item.label}</span>}
                </Button>
              </Link>
            );
          })}

          {/* Operator Mode link for admins */}
          {isAdmin && (
            <div className="pt-4 mt-4 border-t border-sidebar-border">
              <Link to="/operator/ingestion-health">
                <Button
                  variant="nav"
                  className={cn(
                    "w-full relative",
                    collapsed ? "justify-center px-2" : "justify-start",
                    "bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/30 font-medium"
                  )}
                  title={collapsed ? `Operator Mode${pendingCount > 0 ? ` (${pendingCount} pending)` : ''}` : undefined}
                >
                  <Settings className="h-4 w-4" />
                  {!collapsed && <span>⚙️ Operator Mode</span>}
                  {pendingCount > 0 && (
                    <Badge 
                      variant="destructive" 
                      className={cn(
                        "h-5 min-w-5 px-1.5 text-xs font-bold",
                        collapsed ? "absolute -top-1 -right-1" : "ml-auto"
                      )}
                    >
                      {pendingCount > 99 ? '99+' : pendingCount}
                    </Badge>
                  )}
                </Button>
              </Link>
            </div>
          )}
        </nav>

        {/* User section */}
        <div className="p-3 border-t border-sidebar-border space-y-2">
          {/* Show Sign In button when logged out */}
          {!isLoading && !user && (
            <Button
              variant="default"
              className={cn("w-full", collapsed ? "px-2" : "")}
              onClick={() => setShowAuthModal(true)}
            >
              <LogIn className="h-4 w-4" />
              {!collapsed && <span className="ml-2">Sign In</span>}
            </Button>
          )}

          {/* User info when logged in */}
          {user && currentUser && !collapsed && (
            <div className="px-3 py-2 rounded-lg bg-muted/30">
              <p className="text-sm font-medium text-foreground truncate">{currentUser.dealer_name}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {isAdmin ? '🔑 Admin' : '🚗 Dealer'}
              </p>
            </div>
          )}
          
          {/* Email display */}
          {!collapsed && user && (
            <div className="px-1">
              <p className="text-xs text-muted-foreground truncate" title={currentUser?.email}>
                {currentUser?.dealer_name || currentUser?.email || 'Not linked'}
              </p>
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="iconSm"
              onClick={() => setCollapsed(!collapsed)}
              className="text-muted-foreground hover:text-foreground"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
            
            {!collapsed && user && (
              <>
                <PushNotificationPrompt showOnMount />
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={logout}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Auth Modal */}
      <AuthModal open={showAuthModal} onOpenChange={setShowAuthModal} />
    </>
  );
}
