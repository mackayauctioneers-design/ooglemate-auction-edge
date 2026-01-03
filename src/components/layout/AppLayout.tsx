import { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { BobAvatar } from '@/components/valo/BobAvatar';
import { useAuth } from '@/contexts/AuthContext';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation();
  const { currentUser } = useAuth();
  
  // Don't show Bob on the ValoPage (it has its own BobAvatar)
  const isValoPage = location.pathname === '/valo';
  
  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
      
      {/* Bob Avatar - available on all pages except ValoPage */}
      {!isValoPage && <BobAvatar dealerName={currentUser?.dealer_name} />}
    </div>
  );
}
