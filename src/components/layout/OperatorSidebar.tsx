import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  Database,
  Fingerprint,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Home,
  Target,
  FlaskConical,
  Bell,
  ClipboardList,
  Crosshair,
  Calendar,
  DollarSign,
  BarChart3,
  Trophy,
  Map,
  Bookmark,
  TrendingUp,
  Building2,
  Users,
  Car,
  TrendingDown,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useState } from 'react';

// ============================================================================
// OPERATOR MODE NAVIGATION
// ============================================================================
// Backend/internal-only navigation for admin/internal users.
// Dealers cannot see or access these routes.
// ============================================================================

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

// Flat day-to-day list, in operator workflow order.
const operatorItems: NavItem[] = [
  { path: '/', label: 'Trading Desk', icon: DollarSign },
  { path: '/operator/alerts-matches', label: 'Alerts & Matches', icon: Bell },
  { path: '/operator/car-sales-watch', label: 'Car Sales Watch', icon: TrendingDown },
  { path: '/operator/buy-intelligence', label: 'Buy Intelligence', icon: Trophy },
  { path: '/operator/sources', label: 'Dealer Sales Data', icon: Database },
  { path: '/log-sale', label: 'Log Sale', icon: DollarSign },
  { path: '/operator/pipeline', label: 'Source Health', icon: Activity },
];

// Less-frequently used admin and review screens, tucked away by default.
const adminItems: NavItem[] = [
  { path: '/operator/dealers', label: 'Dealer Management', icon: Users },
  { path: '/operator/dealer-profiles', label: 'Dealer Profiles', icon: Building2 },
  { path: '/intelligence', label: 'Dealer Intelligence', icon: TrendingUp },
  { path: '/operator/demand-desk', label: 'Demand Desk', icon: Car },
  { path: '/operator/morning-brief', label: "Tomorrow's Targets", icon: Target },
  { path: '/today', label: 'Today', icon: Calendar },
  { path: '/dealer-dashboard', label: 'Dealer Dashboard', icon: BarChart3 },
  { path: '/regional', label: 'Regional Dashboard', icon: Map },
  { path: '/operator/fingerprints', label: 'Fingerprints Explorer', icon: Fingerprint },
  { path: '/operator/fingerprint-alerts', label: 'Alert Controls', icon: Bell },
  { path: '/operator/targets', label: 'Targets Pool', icon: Crosshair },
  { path: '/operator/benchmark-gaps', label: 'Benchmark Gaps', icon: Target },
  { path: '/operator/trigger-qa', label: 'Trigger QA', icon: FlaskConical },
  { path: '/buyer-review', label: 'Buyer Review Queue', icon: ClipboardList },
  { path: '/sales-review', label: 'Sales Review', icon: ClipboardList },
  { path: '/saved-searches', label: 'Saved Searches', icon: Bookmark },
  { path: '/operator/dealer-specs', label: 'Dealer Buy Specs', icon: Target },
  { path: '/fleet/dashboard', label: 'Fleet Dashboard', icon: Building2 },
  { path: '/fleet/buyer-terminal', label: 'Buyer Terminal', icon: Users },
];

export function OperatorSidebar() {
  const location = useLocation();
  const { currentUser, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  const renderItem = (item: NavItem) => {
    const isActive =
      location.pathname === item.path ||
      (item.path === '/' && location.pathname === '/operator/trading-desk');
    return (
      <Link key={item.path} to={item.path}>
        <Button
          variant={isActive ? 'navActive' : 'nav'}
          className={cn(
            'w-full',
            collapsed ? 'justify-center px-2' : 'justify-start'
          )}
          title={collapsed ? item.label : undefined}
        >
          <item.icon className="h-4 w-4" />
          {!collapsed && <span>{item.label}</span>}
        </Button>
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        'flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          'flex items-center justify-between px-4 h-16 border-b border-sidebar-border',
          collapsed && 'justify-center px-2'
        )}
      >
        <Link to="/operator" className={cn('flex items-center gap-3', collapsed && 'gap-0')}>
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-destructive text-destructive-foreground font-bold text-lg">
            ⚙
          </div>
          {!collapsed && (
            <div>
              <h1 className="font-semibold text-foreground">Operator Mode</h1>
              <p className="text-xs text-muted-foreground">Backend Controls</p>
            </div>
          )}
        </Link>
      </div>

      {/* Back to Dealer View */}
      <div className="p-3 border-b border-sidebar-border">
        <Link to="/">
          <Button
            variant="outline"
            className={cn(
              'w-full',
              collapsed ? 'justify-center px-2' : 'justify-start'
            )}
          >
            <Home className="h-4 w-4" />
            {!collapsed && <span>Trading Desk home</span>}
          </Button>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {operatorItems.map(renderItem)}

        {/* Admin group, closed by default */}
        <div className="pt-2">
          <Button
            variant="nav"
            onClick={() => setAdminOpen(!adminOpen)}
            className={cn(
              'w-full',
              collapsed ? 'justify-center px-2' : 'justify-start'
            )}
            title={collapsed ? 'Admin' : undefined}
            aria-expanded={adminOpen}
          >
            <Settings className="h-4 w-4" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Admin</span>
                {adminOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </>
            )}
          </Button>
          {adminOpen && <div className="mt-1 space-y-1">{adminItems.map(renderItem)}</div>}
        </div>
      </nav>

      {/* User section */}
      <div className="p-3 border-t border-sidebar-border space-y-2">
        {currentUser && !collapsed && (
          <div className="px-3 py-2 rounded-lg bg-destructive/10">
            <p className="text-sm font-medium text-foreground truncate">{currentUser.dealer_name}</p>
            <p className="text-xs text-destructive">
              🔧 Operator Mode
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
            <Button
              variant="ghost"
              size="iconSm"
              onClick={logout}
              className="text-muted-foreground hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
