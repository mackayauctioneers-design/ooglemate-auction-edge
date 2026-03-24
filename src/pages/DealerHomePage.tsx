import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DealerLayout } from '@/components/layout/DealerLayout';
import { Bot, Crosshair, BarChart3, Settings, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SubInfo {
  plan_id: string;
  status: string;
}

export default function DealerHomePage() {
  const { currentUser, user } = useAuth();
  const [sub, setSub] = useState<SubInfo | null>(null);
  const [huntCount, setHuntCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    // Fetch subscription
    supabase
      .from('subscriptions')
      .select('plan_id, status')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (data) setSub(data); });

    // Fetch hunt count
    supabase
      .from('dealer_fingerprints')
      .select('id', { count: 'exact', head: true })
      .eq('dealer_name', currentUser?.dealer_name || '')
      .eq('is_active', true)
      .then(({ count }) => setHuntCount(count || 0));
  }, [user, currentUser]);

  const quickLinks = [
    { to: '/ooglebot', label: 'OogleBot', icon: Bot, desc: 'Ask your AI assistant' },
    { to: '/my-hunts', label: 'My Hunts', icon: Crosshair, desc: `${huntCount} active hunts` },
    { to: '/sales-upload', label: 'My Sales', icon: BarChart3, desc: 'Upload & track' },
    { to: '/settings', label: 'Settings', icon: Settings, desc: 'Profile & billing' },
  ];

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">
            Welcome back{currentUser?.dealer_name ? `, ${currentUser.dealer_name}` : ''}
          </h1>
          <p className="text-muted-foreground mt-1">
            Plan: <span className="font-medium capitalize">{sub?.plan_id || 'starter'}</span>
            {sub?.plan_id === 'starter' && (
              <Link to="/pricing" className="ml-2 text-sm underline">Upgrade →</Link>
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {quickLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="group flex items-center gap-4 rounded-xl border border-border bg-card p-5 hover:border-foreground/30 transition-all"
            >
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted">
                <link.icon className="h-5 w-5 text-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground">{link.label}</p>
                <p className="text-sm text-muted-foreground">{link.desc}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </Link>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
