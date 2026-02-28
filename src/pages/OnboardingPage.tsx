import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PLANS, PlanId } from '@/lib/plans';
import { toast } from 'sonner';
import { Check, ArrowRight, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [dealerName, setDealerName] = useState('');
  const [region, setRegion] = useState('AU-NSW');
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('starter');
  const [loading, setLoading] = useState(false);

  // Step 1: Profile
  // Step 2: Plan
  // Step 3: First hunt (simplified)

  const handleFinish = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Create dealer profile if name provided
      if (dealerName.trim()) {
        await supabase.from('dealer_profiles').insert({
          dealer_name: dealerName.trim(),
          region_id: region,
          user_id: user.id,
        });

        // Link user
        const { data: profile } = await supabase
          .from('dealer_profiles')
          .select('id')
          .eq('user_id', user.id)
          .limit(1)
          .single();

        if (profile) {
          await supabase.from('dealer_profile_user_links').insert({
            user_id: user.id,
            dealer_profile_id: profile.id,
          });
        }
      }

      // If paid plan, redirect to checkout
      if (selectedPlan !== 'starter') {
        const plan = PLANS[selectedPlan];
        if (plan.stripe_price_id) {
          const { data, error } = await supabase.functions.invoke('create-checkout-session', {
            body: { price_id: plan.stripe_price_id },
          });
          if (!error && data?.url) {
            window.open(data.url, '_blank');
          }
        }
      }

      toast.success('Welcome to Carbitrage!');
      navigate('/dealer-home', { replace: true });
    } catch (err: any) {
      toast.error(err.message || 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={cn(
                'h-2 rounded-full transition-all',
                s === step ? 'w-10 bg-foreground' : s < step ? 'w-6 bg-foreground/60' : 'w-6 bg-border'
              )}
            />
          ))}
        </div>

        {/* Step 1: Profile */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-foreground">Set up your profile</h2>
              <p className="text-muted-foreground mt-1">Tell us about your dealership</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Dealership Name</Label>
                <Input
                  value={dealerName}
                  onChange={(e) => setDealerName(e.target.value)}
                  placeholder="e.g. Metro Motors"
                />
              </div>
              <div className="space-y-2">
                <Label>Region</Label>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="AU-NSW">NSW</option>
                  <option value="AU-VIC">VIC</option>
                  <option value="AU-QLD">QLD</option>
                  <option value="AU-WA">WA</option>
                  <option value="AU-SA">SA</option>
                  <option value="AU-TAS">TAS</option>
                  <option value="AU-NT">NT</option>
                  <option value="AU-ACT">ACT</option>
                </select>
              </div>
            </div>
            <Button className="w-full" onClick={() => setStep(2)}>
              Next <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Step 2: Plan */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-foreground">Choose your plan</h2>
              <p className="text-muted-foreground mt-1">You can upgrade anytime</p>
            </div>
            <div className="space-y-3">
              {(Object.keys(PLANS) as PlanId[]).map((planId) => {
                const plan = PLANS[planId];
                const selected = selectedPlan === planId;
                return (
                  <button
                    key={planId}
                    onClick={() => setSelectedPlan(planId)}
                    className={cn(
                      'w-full text-left rounded-lg border p-4 transition-all',
                      selected ? 'border-foreground bg-accent' : 'border-border hover:border-foreground/30'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-foreground">{plan.name}</span>
                        <span className="text-muted-foreground ml-2 text-sm">{plan.priceLabel}</span>
                      </div>
                      {selected && <Check className="h-5 w-5 text-foreground" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {plan.features.slice(0, 2).join(' · ')}
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep(3)} className="flex-1">
                Next <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: First hunt */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-foreground">You're all set!</h2>
              <p className="text-muted-foreground mt-1">
                {selectedPlan === 'starter'
                  ? "Start exploring with your free plan."
                  : "We'll take you to checkout, then your dashboard."}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <p className="text-sm text-muted-foreground">Your plan</p>
              <p className="text-lg font-semibold text-foreground mt-1">{PLANS[selectedPlan].name}</p>
              <p className="text-sm text-muted-foreground">{PLANS[selectedPlan].priceLabel}</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={handleFinish} disabled={loading} className="flex-1">
                {loading ? 'Setting up...' : 'Launch Dashboard'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
