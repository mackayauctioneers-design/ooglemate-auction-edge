import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import carbitrageLogo from '@/assets/carbitrage-logo.jpg';

export default function AuthPage() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  useEffect(() => {
    if (!authLoading && user) {
      navigate('/today', { replace: true });
    }
  }, [authLoading, user, navigate]);

  // Splash → login transition
  useEffect(() => {
    const timer = setTimeout(() => setShowLogin(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });

    setLoading(false);
    if (error) { toast.error(error.message); return; }
    if (data.user) { toast.success(`Signed in as ${data.user.email}`); navigate('/today', { replace: true }); }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <Loader2 className="h-8 w-8 animate-spin text-white/40" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-black">
      {/* Stage 1: Brand Splash */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-700 ease-in-out ${
          showLogin ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'
        }`}
      >
        <img
          src={carbitrageLogo}
          alt="Carbitrage – Powered by CaroogleAi"
          className="w-72 sm:w-96 max-w-[80vw] object-contain"
        />
      </div>

      {/* Stage 2: Login Reveal */}
      <div
        className={`relative z-10 w-full max-w-md px-4 transition-all duration-700 ease-in-out delay-200 ${
          showLogin ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none'
        }`}
      >
        {/* Small branding above card */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-white">
            Carbitrage
          </h1>
          <p className="text-sm text-white/50 mt-1 tracking-wide">
            powered by <span className="text-white/70">CaroogleAi</span>
          </p>
        </div>

        {/* Login card */}
        <div className="rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-2xl">
          <div className="text-center mb-5">
            <h2 className="text-lg font-semibold text-white">Sign in to your account</h2>
            <p className="text-sm text-white/40 mt-0.5">Access your dealer intelligence</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login-email" className="text-white/70 text-sm">Email</Label>
              <Input
                id="login-email"
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={loading}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password" className="text-white/70 text-sm">Password</Label>
              <Input
                id="login-password"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
                disabled={loading}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/20"
              />
            </div>
            <Button type="submit" className="w-full bg-white/10 hover:bg-white/20 text-white border border-white/10" disabled={loading}>
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in...</> : 'Sign In'}
            </Button>
          </form>

          <p className="text-center text-xs text-white/30 mt-4">Access is invite-only</p>
        </div>

        <p className="text-center text-xs text-white/20 mt-6">Automotive Truth</p>
      </div>
    </div>
  );
}
