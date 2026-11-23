import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { portalSupabase } from '@/portal/runtime';
import { wholesaleApi } from '@/portal/wholesale/api';
import TradingDeskPage from '@/pages/operator/TradingDeskPage';
import { deskHomeDestination } from './homeAccess';

/** Root-only routing boundary. Existing sign-in and wholesale permissions remain unchanged. */
export default function TradingDeskHome() {
  const [destination, setDestination] = useState<ReturnType<typeof deskHomeDestination> | null>(null);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const subscriptions: Array<() => void> = [];
    const check = async () => {
      const version = ++generation;
      setDestination(null);
      try {
        const portal = await portalSupabase();
        const [sharedSession, portalSession] = await Promise.all([supabase.auth.getSession(), portal.auth.getSession()]);
        const sharedUser = sharedSession.data.session?.user;
        const signedIn = Boolean(sharedUser || portalSession.data.session);
        const [role, wholesale] = await Promise.all([
          sharedUser ? supabase.rpc('get_user_role', { _user_id: sharedUser.id }).then(result => result.error ? null : result.data) : Promise.resolve(null),
          portalSession.data.session ? wholesaleApi.me().catch(() => null) : Promise.resolve(null),
        ]);
        if (active && version === generation) setDestination(deskHomeDestination({ signedIn, operatorRole: role, buyer: Boolean(wholesale?.buyer), franchiseDealer: Boolean(wholesale?.dealer) }));
      } catch {
        if (active && version === generation) setDestination('/portal/login');
      }
    };
    void portalSupabase().then(portal => {
      if (!active) return;
      for (const client of new Set([supabase, portal])) {
        const { data } = client.auth.onAuthStateChange(event => {
          if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
          // Clear the previous desk immediately; defer session reads outside the auth callback.
          generation += 1;
          setDestination(null);
          window.setTimeout(() => { if (active) void check(); }, 0);
        });
        subscriptions.push(() => data.subscription.unsubscribe());
      }
      void check();
    }).catch(() => { if (active) setDestination('/portal/login'); });
    return () => { active = false; generation += 1; subscriptions.forEach(unsubscribe => unsubscribe()); };
  }, []);
  if (!destination) return <div className="flex min-h-screen items-center justify-center bg-background" role="status"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none" /><span className="sr-only">Checking your account…</span></div>;
  if (destination !== 'desk') return <Navigate to={destination} replace />;
  return <TradingDeskPage mode="operator" />;
}