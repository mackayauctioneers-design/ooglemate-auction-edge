import { ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { AuthModal } from '@/components/auth/AuthModal';
import { Loader2 } from 'lucide-react';

interface RequireAuthProps {
  children: ReactNode;
}

/**
 * RequireAuth - Redirects to home and opens auth modal if no session.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      // Redirect to home and show auth modal
      navigate('/', { replace: true });
      setShowAuthModal(true);
    }
  }, [isLoading, user, navigate]);

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If not logged in, show modal (will redirect to home)
  if (!user) {
    return <AuthModal open={showAuthModal} onOpenChange={setShowAuthModal} />;
  }

  return <>{children}</>;
}
