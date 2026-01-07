import { Link, useLocation } from 'react-router-dom';
import { 
  Car, 
  BarChart3, 
  FileText, 
  Bell, 
  LogOut,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Calendar,
  Search,
  ClipboardList,
  Crosshair,
  Bookmark,
  Wrench,
  DollarSign,
  Sparkles,
  Eye,
  MapPin
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { PushNotificationPrompt } from '@/components/notifications/PushNotificationPrompt';

// ============================================================================
// NAVIGATION: DEALER MODE vs ADMIN MODE
// ============================================================================
// PHASE 3: VALO/Ask Frank is admin-only during testing phase.
// Dealer Mode: Search Lots, Upcoming Auctions, Matches (results only), Valuation
// Admin Mode: Everything above PLUS Ask Frank, Admin Tools, full diagnostics, 
//             Buyer Review Queue, Sales Review, Fingerprints, etc.
// ============================================================================

const navItems = [
  // === ADMIN ONLY: PHASE 3 - Ask Bob (formerly Frank) at top ===
  { path: '/valo', label: 'Ask Bob', icon: Sparkles, highlight: true, adminOnly: true },
  
  // === SHARED: All users ===
  { path: '/', label: "Today's Opportunities", icon: BarChart3 },
  { path: '/upcoming-auctions', label: 'Upcoming Auctions', icon: Calendar },
  { path: '/search-lots', label: 'Search Lots', icon: Search },
  { path: '/matches', label: 'Matches', icon: Crosshair },
  { path: '/valuation', label: 'Valuation', icon: DollarSign },
  { path: '/dealer-dashboard', label: 'My Dashboard', icon: MapPin },
  
  // === ADMIN ONLY: Sales management ===
  { path: '/log-sale', label: 'Log Sale', icon: FileText, adminOnly: true },
  { path: '/sales-review', label: 'Sales Review', icon: ClipboardList, adminOnly: true },
  { path: '/fingerprints', label: 'Sale Fingerprints', icon: Car, adminOnly: true },
  { path: '/saved-searches', label: 'Saved Searches', icon: Bookmark, adminOnly: true },
  
  // === ADMIN ONLY: Review & management ===
  { path: '/regional-dashboard', label: 'Regional Dashboard', icon: MapPin, adminOnly: true },
  { path: '/buyer-review-queue', label: 'Buyer Review Queue', icon: Eye, adminOnly: true },
  { path: '/alerts', label: 'Alert Log', icon: Bell, adminOnly: true },
  { path: '/admin-tools', label: 'Admin Tools', icon: Wrench, adminOnly: true },
  
  // === SHARED: Help ===
  { path: '/help', label: 'How to Use', icon: HelpCircle },
];

export function AppSidebar() {
  const location = useLocation();
  const { currentUser, isAdmin, logout, user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const filteredNavItems = navItems.filter(item => !item.adminOnly || isAdmin);

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
        {filteredNavItems.map(item => {
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
      </nav>

      {/* User section */}
      <div className="p-3 border-t border-sidebar-border space-y-2">
        {currentUser && !collapsed && (
          <div className="px-3 py-2 rounded-lg bg-muted/30">
            <p className="text-sm font-medium text-foreground truncate">{currentUser.dealer_name}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {currentUser.role === 'admin' ? '🔑 Admin' : '🚗 Dealer'}
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
