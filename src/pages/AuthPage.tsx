import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  const [searchParams] = useSearchParams();
  const { user, isLoading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [isSignUp, setIsSignUp] = useState(searchParams.get('mode') === 'signup');
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [magicLinkMode, setMagicLinkMode] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  useEffect(() => {
    if (!authLoading && user) {
      navigate('/dealer-home', { replace: true });
    }
  }, [authLoading, user, navigate]);

  useEffect(() => {
    const timer = setTimeout(() => setShowLogin(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setMagicLinkSent(true);
    toast.success('Check your email for the magic link!');
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { toast.error('Enter your email first'); return; }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setResetSent(true);
    toast.success('Password reset link sent — check your email!');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      setLoading(false);
      if (error) { toast.error(error.message); return; }
      if (data.user && !data.session) {
        toast.success('Check your email to confirm your account');
      } else if (data.session) {
        toast.success('Account created!');
        navigate('/onboarding', { replace: true });
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setLoading(false);
      if (error) { toast.error(error.message); return; }
      if (data.user) {
        toast.success(`Signed in as ${data.user.email}`);
        navigate('/dealer-home', { replace: true });
      }
    }
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

      {/* Stage 2: Auth Form */}
      <div
        className={`relative z-10 w-full max-w-md px-4 transition-all duration-700 ease-in-out delay-200 ${
          showLogin ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none'
        }`}
      >
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-white">Carbitrage</h1>
          <p className="text-sm text-white/50 mt-1 tracking-wide">
            powered by <span className="text-white/70">CaroogleAi</span>
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-6 shadow-2xl">
          <div className="text-center mb-5">
            <h2 className="text-lg font-semibold text-white">
              {isSignUp ? 'Create your account' : 'Sign in to your account'}
            </h2>
            <p className="text-sm text-white/40 mt-0.5">
              {isSignUp ? 'Start finding deals today' : 'Access your dealer intelligence'}
            </p>
          </div>

          {magicLinkMode ? (
            magicLinkSent ? (
              <div className="text-center space-y-3">
                <p className="text-white/70">Magic link sent to <span className="text-white font-medium">{email}</span></p>
                <p className="text-sm text-white/40">Check your inbox and click the link to sign in.</p>
                <button onClick={() => { setMagicLinkSent(false); setMagicLinkMode(false); }} className="text-white/50 underline text-sm">
                  Back to sign in
                </button>
              </div>
            ) : (
              <form onSubmit={handleMagicLink} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="magic-email" className="text-white/70 text-sm">Email</Label>
                  <Input
                    id="magic-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
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
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending link...</>
                  ) : (
                    'Send Magic Link'
                  )}
                </Button>
                <button onClick={() => setMagicLinkMode(false)} className="text-white/50 underline text-sm w-full text-center">
                  Sign in with password instead
                </button>
              </form>
            )
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="auth-email" className="text-white/70 text-sm">Email</Label>
                  <Input
                    id="auth-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    disabled={loading}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/20"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="auth-password" className="text-white/70 text-sm">Password</Label>
                  <Input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                    minLength={6}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/20"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full bg-white/10 hover:bg-white/20 text-white border border-white/10"
                  disabled={loading}
                >
                  {loading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isSignUp ? 'Creating...' : 'Signing in...'}</>
                  ) : (
                    isSignUp ? 'Sign Up' : 'Sign In'
                  )}
                </Button>
              </form>

              {!isSignUp && (
                <button onClick={() => setMagicLinkMode(true)} className="text-white/50 underline text-sm w-full text-center mt-3">
                  Sign in with magic link (no password)
                </button>
              )}

              <p className="text-center text-sm text-white/40 mt-4">
                {isSignUp ? (
                  <>Already have an account?{' '}
                    <button onClick={() => setIsSignUp(false)} className="text-white/70 underline">
                      Sign in
                    </button>
                  </>
                ) : (
                  <>Need an account?{' '}
                    <button onClick={() => setIsSignUp(true)} className="text-white/70 underline">
                      Sign up
                    </button>
                  </>
                )}
              </p>
            </>
          )}
        </div>

        <p className="text-center text-xs text-white/20 mt-6">Automotive Truth</p>
      </div>
    </div>
  );
}
