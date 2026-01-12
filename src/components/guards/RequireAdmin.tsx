import { ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { AuthModal } from '@/components/auth/AuthModal';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface RequireAdminProps {
  children: ReactNode;
}

/**
 * RequireAdmin - Requires user_roles.role in ('admin', 'internal').
 * Redirects to home if not authenticated or not admin.
 */
export function RequireAdmin({ children }: RequireAdminProps) {
  const { user, isAdmin, isLoading } = useAuth();
  const navigate = useNavigate();
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        // Not logged in - redirect and show auth modal
        navigate('/', { replace: true });
        setShowAuthModal(true);
      } else if (!isAdmin) {
        // Logged in but not admin - redirect with message
        toast.error('Admin access required');
        navigate('/', { replace: true });
      }
    }
  }, [isLoading, user, isAdmin, navigate]);

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // If not logged in, show modal
  if (!user) {
    return <AuthModal open={showAuthModal} onOpenChange={setShowAuthModal} />;
  }

  // If logged in but not admin, don't render (redirect happens in useEffect)
  if (!isAdmin) {
    return null;
  }

  return <>{children}</>;
}
