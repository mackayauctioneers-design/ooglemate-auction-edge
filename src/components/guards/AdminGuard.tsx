import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface AdminGuardProps {
  children: ReactNode;
  redirectTo?: string;
}

/**
 * AdminGuard - Protects routes that require admin role.
 * Redirects non-admin users to the specified route (default: home).
 * 
 * Usage:
 * <AdminGuard>
 *   <AdminOnlyPage />
 * </AdminGuard>
 */
export function AdminGuard({ children, redirectTo = '/' }: AdminGuardProps) {
  const { isAdmin, currentUser } = useAuth();

  // If not logged in or not admin, redirect
  if (!currentUser || !isAdmin) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}

/**
 * AdminOnly - Conditionally renders children only for admin users.
 * Does NOT redirect - simply hides content from non-admins.
 * 
 * Usage:
 * <AdminOnly>
 *   <DiagnosticsPanel />
 * </AdminOnly>
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  
  if (!isAdmin) {
    return null;
  }

  return <>{children}</>;
}

/**
 * DealerOnly - Conditionally renders children only for dealer users.
 * Does NOT redirect - simply hides content from admins.
 * 
 * Usage:
 * <DealerOnly>
 *   <DealerDashboard />
 * </DealerOnly>
 */
export function DealerOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  
  if (isAdmin) {
    return null;
  }

  return <>{children}</>;
}
