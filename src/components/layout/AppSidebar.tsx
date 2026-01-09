import { Link, useLocation } from 'react-router-dom';
import { 
  BarChart3, 
  LogOut,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Calendar,
  Search,
  Crosshair,
  DollarSign,
  Sparkles,
  MapPin,
  Settings
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { PushNotificationPrompt } from '@/components/notifications/PushNotificationPrompt';

// ============================================================================
// DEALER NAVIGATION
// ============================================================================
// Clean dealer-focused navigation. Admin items moved to Operator Mode.
// ============================================================================

const dealerNavItems = [
  { path: '/valo', label: 'Ask Bob', icon: Sparkles, highlight: true },
  { path: '/', label: "Today's Opportunities", icon: BarChart3 },
  { path: '/upcoming-auctions', label: 'Upcoming Auctions', icon: Calendar },
  { path: '/search-lots', label: 'Search Lots', icon: Search },
  { path: '/matches', label: 'Matches', icon: Crosshair },
  { path: '/valuation', label: 'Valuation', icon: DollarSign },
  { path: '/dealer-dashboard', label: 'My Dashboard', icon: MapPin },
  { path: '/help', label: 'How to Use', icon: HelpCircle },
];

export function AppSidebar() {
  const location = useLocation();
  const { currentUser, isAdmin, logout, user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  return (
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
            O
          </div>
          {!collapsed && (
            <div>
              <h1 className="font-semibold text-foreground">OogleMate</h1>
              <p className="text-xs text-muted-foreground">Auction Edge</p>
            </div>
          )}
        </div>
        {!collapsed && <NotificationBell />}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {dealerNavItems.map(item => {
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
                  "w-full",
                  collapsed ? "justify-center px-2" : "justify-start",
                  "text-destructive hover:bg-destructive/10"
                )}
                title={collapsed ? "Operator Mode" : undefined}
              >
                <Settings className="h-4 w-4" />
                {!collapsed && <span>Operator Mode</span>}
              </Button>
            </Link>
          </div>
        )}
      </nav>

      {/* User section */}
      <div className="p-3 border-t border-sidebar-border space-y-2">
        {currentUser && !collapsed && (
          <div className="px-3 py-2 rounded-lg bg-muted/30">
            <p className="text-sm font-medium text-foreground truncate">{currentUser.dealer_name}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {isAdmin ? '🔑 Admin' : '🚗 Dealer'}
            </p>
          </div>
        )}
        
        {/* User info */}
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
          
          {!collapsed && (
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
  );
}
