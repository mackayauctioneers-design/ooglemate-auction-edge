import { createContext, useContext, useState, ReactNode } from 'react';
import { Dealer } from '@/types';
import { mockDealers } from '@/services/mockData';

interface AuthContextType {
  currentUser: Dealer | null;
  isAdmin: boolean;
  login: (dealerName: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<Dealer | null>(() => {
    // Default to admin user for demo
    return mockDealers.find(d => d.dealer_name === 'Dave') || null;
  });

  const isAdmin = currentUser?.role === 'admin';

  const login = (dealerName: string) => {
    const dealer = mockDealers.find(d => d.dealer_name === dealerName);
    if (dealer) {
      setCurrentUser(dealer);
    }
  };

  const logout = () => {
    setCurrentUser(null);
  };

  return (
    <AuthContext.Provider value={{ currentUser, isAdmin, login, logout }}>
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
