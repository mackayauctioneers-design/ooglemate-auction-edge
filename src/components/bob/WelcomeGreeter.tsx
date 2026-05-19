import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useBob } from '@/contexts/BobContext';

/**
 * One-shot welcome when a dealer first lands in the app this session.
 * Shows a toast and seeds Bob with a greeting so the panel opens warmly.
 * Keyed in sessionStorage so it only fires once per browser session per user.
 */
export function WelcomeGreeter() {
  const { user, dealerProfile } = useAuth();
  const { greet } = useBob();
  const firedRef = useRef(false);

  useEffect(() => {
    if (!user || firedRef.current) return;

    const key = `carbitrage:welcomed:${user.id}`;
    if (sessionStorage.getItem(key)) {
      firedRef.current = true;
      return;
    }

    const dealerName = dealerProfile?.dealer_name?.trim();
    const contactName =
      (user.user_metadata as any)?.first_name ||
      (user.user_metadata as any)?.full_name?.split(' ')?.[0] ||
      dealerName?.split(' ')?.[0] ||
      'mate';

    const dealerLabel = dealerName ? ` at ${dealerName}` : '';

    firedRef.current = true;
    sessionStorage.setItem(key, '1');

    // Toast — visible immediately, dismissible.
    toast.success(`Welcome back, ${contactName}`, {
      description: dealerName
        ? `${dealerName} — your trading desk is ready.`
        : 'Your trading desk is ready.',
      duration: 6000,
    });

    // Bob says hi too, slightly delayed so the panel doesn't fight the toast.
    const t = setTimeout(() => {
      greet(
        `G'day ${contactName}${dealerLabel} 👋\n\n` +
          `Bob here. I've got your trading desk loaded — fresh deals, live auctions and your sales truth all in one place.\n\n` +
          `Ask me anything: *"what should I buy today?"*, *"do a valo"*, or *"show me hot auctions"*.`,
      );
    }, 800);

    return () => clearTimeout(t);
  }, [user, dealerProfile, greet]);

  return null;
}
