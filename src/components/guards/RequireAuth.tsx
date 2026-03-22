import { ReactNode, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface RequireAuthProps {
  children: ReactNode;
}

/**
 * RequireAuth - Redirects unauthenticated users to /auth.
 * New dealers without a profile are redirected to /onboarding/win-flow.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const { user, isLoading, dealerProfile, role } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      navigate('/auth', { replace: true });
      return;
    }

    // Admins/operators skip onboarding redirect
    if (role === 'admin' || role === 'internal') return;

    // If dealer has no profile, hasn't completed onboarding, and isn't already on onboarding, redirect
    const isOnboardingRoute = location.pathname.startsWith('/onboarding');
    const hasCompletedOnboarding = localStorage.getItem('carbitrage_onboarding_complete') === 'true';
    if (!dealerProfile && !hasCompletedOnboarding && !isOnboardingRoute) {
      navigate('/onboarding/win-flow', { replace: true });
    }
  }, [isLoading, user, dealerProfile, role, navigate, location.pathname]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
