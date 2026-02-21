import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { DollarSign, BarChart3, FileText, LogOut, LogIn, ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { AuthModal } from '@/components/auth/AuthModal';

const dealerNav = [
  { path: '/trading-desk', label: 'Trading Desk', icon: DollarSign },
  { path: '/sales-upload', label: 'My Sales', icon: BarChart3 },
  { path: '/deals', label: 'Closed Deals', icon: FileText },
];

interface DealerLayoutProps {
  children: ReactNode;
}

export function DealerLayout({ children }: DealerLayoutProps) {
  const location = useLocation();
  const { currentUser, user, isLoading, isAdmin, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  return (
    <>
      <div className="flex min-h-screen w-full bg-background">
        <aside
          className={cn(
            "flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300",
            collapsed ? "w-16" : "w-56"
          )}
        >
          {/* Brand */}
          <div className={cn(
            "flex items-center justify-between px-4 h-14 border-b border-sidebar-border",
            collapsed && "justify-center px-2"
          )}>
            <div className={cn("flex items-center gap-3", collapsed && "gap-0")}>
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground font-bold text-lg">
                C
              </div>
              {!collapsed && (
                <span className="font-semibold text-foreground text-sm">Carbitrage</span>
              )}
            </div>
            {!collapsed && user && <NotificationBell />}
          </div>

          {/* Nav */}
          <nav className="flex-1 p-3 space-y-1">
            {dealerNav.map(item => {
              if (!user) return null;
              const isActive = location.pathname === item.path;
              return (
                <Link key={item.path} to={item.path}>
                  <Button
                    variant={isActive ? "default" : "ghost"}
                    className={cn(
                      "w-full",
                      collapsed ? "justify-center px-2" : "justify-start"
                    )}
                    size="sm"
                  >
                    <item.icon className="h-4 w-4" />
                    {!collapsed && <span className="ml-2">{item.label}</span>}
                  </Button>
                </Link>
              );
            })}

            {/* Operator Mode link for admins */}
            {isAdmin && (
              <div className="pt-4 mt-4 border-t border-sidebar-border">
                <Link to="/operator/ingestion-health">
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "w-full",
                      collapsed ? "justify-center px-2" : "justify-start",
                      "bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/30 font-medium"
                    )}
                  >
                    <Settings className="h-4 w-4" />
                    {!collapsed && <span>⚙️ Operator Mode</span>}
                  </Button>
                </Link>
              </div>
            )}
          </nav>

          {/* Footer */}
          <div className="p-3 border-t border-sidebar-border space-y-2">
            {!isLoading && !user && (
              <Button
                variant="default"
                size="sm"
                className={cn("w-full", collapsed && "px-2")}
                onClick={() => setShowAuthModal(true)}
              >
                <LogIn className="h-4 w-4" />
                {!collapsed && <span className="ml-2">Sign In</span>}
              </Button>
            )}

            {user && currentUser && !collapsed && (
              <div className="px-2 py-1.5 rounded-md bg-muted/30">
                <p className="text-xs font-medium text-foreground truncate">{currentUser.dealer_name}</p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={() => setCollapsed(!collapsed)}
              >
                {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </Button>
              {!collapsed && user && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={logout}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>

      <AuthModal open={showAuthModal} onOpenChange={setShowAuthModal} />
    </>
  );
}
