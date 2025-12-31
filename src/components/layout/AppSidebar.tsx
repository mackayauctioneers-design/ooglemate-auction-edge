import { Link, useLocation } from 'react-router-dom';
import { 
  Car, 
  BarChart3, 
  FileText, 
  Bell, 
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Calendar,
  Search
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useState } from 'react';

const navItems = [
  { path: '/', label: "Today's Opportunities", icon: BarChart3 },
  { path: '/upcoming-auctions', label: 'Upcoming Auctions', icon: Calendar },
  { path: '/search-lots', label: 'Search Lots', icon: Search },
  { path: '/log-sale', label: 'Log Sale', icon: FileText },
  { path: '/fingerprints', label: 'Sale Fingerprints', icon: Car, adminOnly: true },
  { path: '/alerts', label: 'Alert Log', icon: Bell, adminOnly: true },
  { path: '/help', label: 'How to Use', icon: HelpCircle },
];

export function AppSidebar() {
  const location = useLocation();
  const { currentUser, isAdmin, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const filteredNavItems = navItems.filter(item => !item.adminOnly || isAdmin);

  return (
    <aside 
      className={cn(
        "flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className={cn(
        "flex items-center gap-3 px-4 h-16 border-b border-sidebar-border",
        collapsed && "justify-center px-2"
      )}>
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

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {filteredNavItems.map(item => {
          const isActive = location.pathname === item.path;
          return (
            <Link key={item.path} to={item.path}>
              <Button
                variant={isActive ? "navActive" : "nav"}
                className={cn(
                  "w-full",
                  collapsed ? "justify-center px-2" : "justify-start"
                )}
              >
                <item.icon className="h-4 w-4" />
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
            <p className="text-xs text-muted-foreground capitalize">{currentUser.role}</p>
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
              <Button
                variant="ghost"
                size="iconSm"
                className="text-muted-foreground hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
              </Button>
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
