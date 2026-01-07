import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

// ============================================================================
// AUTH CONTEXT: SUPABASE-BACKED AUTHENTICATION
// ============================================================================
// Roles are fetched from user_roles table, NOT stored client-side.
// - admin/internal: Full access to diagnostics, admin tools, backfills
// - dealer: Restricted access - scoped data, anonymised aggregates
// ============================================================================

type AppRole = 'admin' | 'dealer' | 'internal' | null;

interface DealerProfile {
  dealer_profile_id: string;
  dealer_name: string;
  org_id: string | null;
  region_id: string;
}

// Backward-compatible currentUser type (maps to dealerProfile + user)
interface CurrentUser {
  id: string;
  email: string | undefined;
  dealer_name: string;
  region_id: string;
  role: AppRole;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole;
  dealerProfile: DealerProfile | null;
  // Backward compatibility for components using currentUser
  currentUser: CurrentUser | null;
  isAdmin: boolean;
  isDealer: boolean;
  isLoading: boolean;
  signOut: () => Promise<void>;
  // Legacy aliases
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole>(null);
  const [dealerProfile, setDealerProfile] = useState<DealerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch user role from user_roles table
  const fetchUserRole = async (userId: string): Promise<AppRole> => {
    try {
      const { data, error } = await supabase.rpc('get_user_role', { _user_id: userId });
      if (error) {
        console.error('Error fetching user role:', error);
        return null;
      }
      return data as AppRole;
    } catch (err) {
      console.error('Error fetching user role:', err);
      return null;
    }
  };

  // Fetch dealer profile from dealer_profile_user_links
  const fetchDealerProfile = async (userId: string): Promise<DealerProfile | null> => {
    try {
      const { data, error } = await supabase.rpc('get_dealer_profile_by_user', { _user_id: userId });
      if (error) {
        console.error('Error fetching dealer profile:', error);
        return null;
      }
      return data?.[0] || null;
    } catch (err) {
      console.error('Error fetching dealer profile:', err);
      return null;
    }
  };

  // Load user data (role + profile)
  const loadUserData = async (userId: string) => {
    const [userRole, profile] = await Promise.all([
      fetchUserRole(userId),
      fetchDealerProfile(userId)
    ]);
    setRole(userRole);
    setDealerProfile(profile);
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        console.log('Auth state changed:', event, newSession?.user?.email);
        setSession(newSession);
        setUser(newSession?.user ?? null);
        
        if (newSession?.user) {
          // Defer data fetching to avoid blocking
          setTimeout(() => loadUserData(newSession.user.id), 0);
        } else {
          setRole(null);
          setDealerProfile(null);
        }
        setIsLoading(false);
      }
    );

    // THEN get initial session
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession);
      setUser(initialSession?.user ?? null);
      
      if (initialSession?.user) {
        loadUserData(initialSession.user.id);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setRole(null);
    setDealerProfile(null);
  };

  const isAdmin = role === 'admin' || role === 'internal';
  const isDealer = role === 'dealer';

  // Backward-compatible currentUser object
  const currentUser: CurrentUser | null = user && dealerProfile ? {
    id: user.id,
    email: user.email,
    dealer_name: dealerProfile.dealer_name,
    region_id: dealerProfile.region_id,
    role: role,
  } : user ? {
    // Fallback for users without linked dealer profile
    id: user.id,
    email: user.email,
    dealer_name: user.email || 'Unknown',
    region_id: 'UNKNOWN',
    role: role,
  } : null;

  return (
    <AuthContext.Provider value={{ 
      user,
      session,
      role,
      dealerProfile,
      currentUser,
      isAdmin, 
      isDealer,
      isLoading,
      signOut,
      logout: signOut, // Legacy alias
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
