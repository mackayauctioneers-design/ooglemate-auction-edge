import { ReactNode, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { BobPanel } from '@/components/bob/BobPanel';
import { WelcomeGreeter } from '@/components/bob/WelcomeGreeter';
import { useAuth } from '@/contexts/AuthContext';
import { useIsNestedLayout, LayoutNestingProvider } from './LayoutContext';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const isNested = useIsNestedLayout();
  const location = useLocation();
  const { user } = useAuth();

  if (isNested) return <>{children}</>;
  
  return (
    <LayoutNestingProvider value={true}>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
        
        {/* Bob AI Assistant — available on all pages for logged-in users */}
        {user && <BobPanel />}
      </div>
    </LayoutNestingProvider>
  );
}
