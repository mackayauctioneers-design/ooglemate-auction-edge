import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface AdminGuardProps {
  children: ReactNode;
  redirectTo?: string;
}

/**
 * AdminGuard - Protects routes that require admin/internal role.
 * Checks role from user_roles table (server-side derived).
 * Redirects non-admin users to the specified route (default: home).
 */
export function AdminGuard({ children, redirectTo = '/' }: AdminGuardProps) {
  const { isAdmin, user, isLoading } = useAuth();

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If not logged in or not admin, redirect
  if (!user || !isAdmin) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}

/**
 * AdminOnly - Conditionally renders children only for admin/internal users.
 * Does NOT redirect - simply hides content from non-admins.
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin, isLoading } = useAuth();
  
  if (isLoading || !isAdmin) {
    return null;
  }

  return <>{children}</>;
}

/**
 * DealerOnly - Conditionally renders children only for dealer users.
 * Does NOT redirect - simply hides content from admins.
 */
export function DealerOnly({ children }: { children: ReactNode }) {
  const { isAdmin, isLoading } = useAuth();
  
  if (isLoading || isAdmin) {
    return null;
  }

  return <>{children}</>;
}

/**
 * AuthenticatedOnly - Renders children only if user is logged in.
 */
export function AuthenticatedOnly({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  
  if (isLoading || !user) {
    return null;
  }

  return <>{children}</>;
}
