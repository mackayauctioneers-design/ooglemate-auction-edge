import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  Database,
  Fingerprint,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
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
  Zap,
  Map,
  Bookmark,
  TrendingUp,
  Bot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useState } from 'react';

// ============================================================================
// OPERATOR MODE NAVIGATION
// ============================================================================
// Backend/internal-only sections for admin/internal users.
// Dealers cannot see or access these routes.
// ============================================================================

interface NavSection {
  title: string;
  items: NavItem[];
}

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const operatorSections: NavSection[] = [
  {
    title: 'OogleBot',
    items: [
      { path: '/operator/ooglebot', label: 'OogleBot', icon: Bot },
    ],
  },
  {
    title: 'Trading',
    items: [
      { path: '/operator/trading-desk', label: 'Trading Desk', icon: DollarSign },
      { path: '/today', label: 'Today', icon: Calendar },
      { path: '/dealer-dashboard', label: 'Dealer Dashboard', icon: BarChart3 },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { path: '/intelligence', label: 'Dealer Intelligence', icon: TrendingUp },
      { path: '/operator/buy-intelligence', label: 'Buy Intelligence', icon: Trophy },
      { path: '/retail-signals', label: 'Retail Signals', icon: Zap },
      { path: '/regional', label: 'Regional Dashboard', icon: Map },
    ],
  },
  {
    title: 'Matching & Alerts',
    items: [
      { path: '/operator/alerts-matches', label: 'Alerts & Matches', icon: Bell },
    ],
  },
  {
    title: 'Ingestion',
    items: [
      { path: '/operator/pipeline', label: 'Pipeline Health', icon: Activity },
    ],
  },
  {
    title: 'Matching Engine',
    items: [
      { path: '/operator/fingerprints', label: 'Fingerprints Explorer', icon: Fingerprint },
      { path: '/operator/targets', label: 'Targets Pool', icon: Crosshair },
      { path: '/operator/benchmark-gaps', label: 'Benchmark Gaps', icon: Target },
      { path: '/operator/trigger-qa', label: 'Trigger QA', icon: FlaskConical },
    ],
  },
  {
    title: 'Sources',
    items: [
      { path: '/operator/sources', label: 'Data Sources', icon: Database },
    ],
  },
  {
    title: 'Reviews & Tools',
    items: [
      { path: '/buyer-review', label: 'Buyer Review Queue', icon: ClipboardList },
      { path: '/sales-review', label: 'Sales Review', icon: ClipboardList },
      { path: '/log-sale', label: 'Log Sale', icon: DollarSign },
      { path: '/saved-searches', label: 'Saved Searches', icon: Bookmark },
    ],
  },
  {
    title: 'Admin',
    items: [
      { path: '/operator/dealer-specs', label: 'Dealer Buy Specs', icon: Target },
    ],
  },
];

export function OperatorSidebar() {
  const location = useLocation();
  const { currentUser, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside 
      className={cn(
        "flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className={cn(
        "flex items-center justify-between px-4 h-16 border-b border-sidebar-border",
        collapsed && "justify-center px-2"
      )}>
        <Link to="/operator" className={cn("flex items-center gap-3", collapsed && "gap-0")}>
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
              "w-full",
              collapsed ? "justify-center px-2" : "justify-start"
            )}
          >
            <Home className="h-4 w-4" />
            {!collapsed && <span>Dealer View</span>}
          </Button>
        </Link>
      </div>

      {/* Navigation Sections */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-4">
        {operatorSections.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <h2 className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {section.title}
              </h2>
            )}
            <div className="space-y-1">
              {section.items.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link key={item.path} to={item.path}>
                    <Button
                      variant={isActive ? "navActive" : "nav"}
                      className={cn(
                        "w-full",
                        collapsed ? "justify-center px-2" : "justify-start"
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.label}</span>}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
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
