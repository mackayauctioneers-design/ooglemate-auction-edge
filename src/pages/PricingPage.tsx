import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PLANS, PlanId } from '@/lib/plans';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function PricingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState<string | null>(null);

  const handleSelect = async (planId: PlanId) => {
    const plan = PLANS[planId];

    if (planId === 'starter') {
      if (!user) navigate('/auth?mode=signup');
      else navigate('/dealer-home');
      return;
    }

    if (!user) {
      navigate('/auth?mode=signup');
      return;
    }

    if (!plan.stripe_price_id) return;

    setLoading(planId);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: { price_id: plan.stripe_price_id },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, '_blank');
    } catch (err: any) {
      toast.error(err.message || 'Failed to start checkout');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Choose your plan
          </h1>
          <p className="text-muted-foreground mt-3 text-lg">
            Dealer intelligence that pays for itself on the first deal.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(Object.keys(PLANS) as PlanId[]).map((planId) => {
            const plan = PLANS[planId];
            const isPopular = 'popular' in plan && plan.popular;

            return (
              <div
                key={planId}
                className={cn(
                  'relative rounded-xl border p-6 flex flex-col',
                  isPopular
                    ? 'border-foreground shadow-lg scale-105 bg-card'
                    : 'border-border bg-card'
                )}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-foreground text-background text-xs font-semibold px-3 py-1 rounded-full">
                    Most Popular
                  </div>
                )}

                <h3 className="text-xl font-semibold text-foreground">{plan.name}</h3>
                <div className="mt-3 mb-6">
                  <span className="text-3xl font-bold text-foreground">
                    {plan.price === 0 ? 'Free' : `$${plan.price}`}
                  </span>
                  {plan.price > 0 && (
                    <span className="text-muted-foreground text-sm">/month</span>
                  )}
                </div>

                <ul className="space-y-2.5 flex-1 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-foreground">
                      <Check className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Button
                  className={cn(
                    'w-full',
                    isPopular ? '' : 'variant-outline'
                  )}
                  variant={isPopular ? 'default' : 'outline'}
                  onClick={() => handleSelect(planId)}
                  disabled={loading === planId}
                >
                  {loading === planId
                    ? 'Loading...'
                    : planId === 'starter'
                    ? 'Get Started'
                    : 'Subscribe'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
