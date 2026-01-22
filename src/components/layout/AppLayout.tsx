import { ReactNode, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { BobPanel } from '@/components/bob/BobPanel';
import { useAuth } from '@/contexts/AuthContext';

interface AppLayoutProps {
  children: ReactNode;
}

// Detect if running on iOS
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => {
      const ua = navigator.userAgent;
      const isIOS = /iPhone|iPad|iPod/.test(ua);
      const isSmallScreen = window.innerWidth < 768;
      setIsMobile(isIOS || isSmallScreen);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  return isMobile;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const { currentUser } = useAuth();
  const isMobile = useIsMobile();
  
  // Don't show Bob on ValoPage or on mobile devices (causes crashes)
  const isValoPage = location.pathname === '/valo';
  const showBobAvatar = !isValoPage && !isMobile;
  
  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
      
      {/* Bob Avatar - Voice assistant (desktop only, not on ValoPage) */}
      {showBobAvatar && (
        <BobAvatarLazy dealerName={currentUser?.dealer_name} />
      )}
      
      {/* Bob Panel - Text chat + Daily Brief + Help (all pages, all devices) */}
      <BobPanel />
    </div>
  );
}

// Lazy load BobAvatar to prevent initial load overhead
import { lazy, Suspense } from 'react';
const BobAvatarComponent = lazy(() => import('@/components/valo/BobAvatar').then(m => ({ default: m.BobAvatar })));

function BobAvatarLazy({ dealerName }: { dealerName?: string }) {
  return (
    <Suspense fallback={null}>
      <BobAvatarComponent dealerName={dealerName} />
    </Suspense>
  );
}
