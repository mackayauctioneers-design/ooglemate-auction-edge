import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, CheckCircle } from 'lucide-react';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    // Check for recovery token in URL hash
    const hash = window.location.hash;
    if (hash.includes('type=recovery')) {
      setIsRecovery(true);
    }

    // Listen for auth state change (recovery event)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setSuccess(true);
    toast.success('Password updated successfully');
    setTimeout(() => navigate('/dealer-home', { replace: true }), 2000);
  };

  if (!isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-white/40 mx-auto" />
          <p className="text-white/50 text-sm">Verifying reset link…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">Reset Password</h1>
          <p className="text-white/50 text-sm mt-1">Enter your new password below</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-2xl">
          {success ? (
            <div className="text-center space-y-3">
              <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto" />
              <p className="text-white font-medium">Password updated!</p>
              <p className="text-white/50 text-sm">Redirecting to dashboard…</p>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-white/70 text-sm">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={loading}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/20"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-white/70 text-sm">Confirm Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  disabled={loading}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/20"
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-white/10 hover:bg-white/20 text-white border border-white/10"
                disabled={loading}
              >
                {loading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating…</>
                ) : (
                  'Set New Password'
                )}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
