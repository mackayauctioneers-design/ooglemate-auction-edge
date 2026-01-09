import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface OperatorGuardProps {
  children: ReactNode;
  redirectTo?: string;
}

/**
 * OperatorGuard - Protects /operator routes for admin/internal roles only.
 * Dealers are blocked even if they guess the URL.
 */
export function OperatorGuard({ children, redirectTo = '/' }: OperatorGuardProps) {
  const { isAdmin, user, isLoading } = useAuth();

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If not logged in or not admin/internal, redirect to dealer home
  if (!user || !isAdmin) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
