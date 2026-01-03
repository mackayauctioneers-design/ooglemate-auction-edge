import { createContext, useContext, useState, ReactNode } from 'react';
import { Dealer } from '@/types';
import { mockDealers } from '@/services/mockData';

// ============================================================================
// AUTH CONTEXT: DEALER MODE vs ADMIN MODE
// ============================================================================
// Roles:
// - admin (Dave): Full access to all features including diagnostics, 
//                 raw comp data, backfills, and dealer management
// - dealer (all others): Limited access - search lots, matches (results only),
//                        VALO, their own alerts/notifications
//
// Network Proxy rules:
// - Dealers see ONLY anonymised aggregates (ranges, sample size, confidence)
// - Dealers NEVER see: dealer names, raw transaction rows, locations
// - Admin can see raw contributing comp rows for debugging
// ============================================================================

type UserRole = 'admin' | 'dealer';

interface AuthContextType {
  currentUser: Dealer | null;
  isAdmin: boolean;
  isDealer: boolean;
  role: UserRole | null;
  login: (dealerName: string) => void;
  logout: () => void;
  switchUser: (dealerName: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<Dealer | null>(() => {
    // Default to admin user for demo
    return mockDealers.find(d => d.dealer_name === 'Dave') || null;
  });

  const role: UserRole | null = currentUser?.role === 'admin' ? 'admin' : currentUser ? 'dealer' : null;
  const isAdmin = role === 'admin';
  const isDealer = role === 'dealer';

  const login = (dealerName: string) => {
    const dealer = mockDealers.find(d => d.dealer_name === dealerName);
    if (dealer) {
      setCurrentUser(dealer);
    }
  };

  const logout = () => {
    setCurrentUser(null);
  };

  // For testing: switch between users
  const switchUser = (dealerName: string) => {
    login(dealerName);
  };

  return (
    <AuthContext.Provider value={{ 
      currentUser, 
      isAdmin, 
      isDealer,
      role,
      login, 
      logout,
      switchUser 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
