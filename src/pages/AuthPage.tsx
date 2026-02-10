import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect } from 'react';

export default function AuthPage() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Signup state
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');

  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  useEffect(() => {
    if (!authLoading && user) {
      navigate('/');
    }
  }, [authLoading, user, navigate]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: { emailRedirectTo: window.location.origin },
    });

    setLoading(false);
    if (error) { toast.error(error.message); return; }
    if (data.user) { toast.success('Account created! You are now signed in.'); navigate('/'); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });

    setLoading(false);
    if (error) { toast.error(error.message); return; }
    if (data.user) { toast.success(`Signed in as ${data.user.email}`); navigate('/'); }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Video background */}
      {!videoFailed && (
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          onError={() => setVideoFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
          src="/login-bg.mp4"
        />
      )}

      {/* Fallback static bg */}
      {videoFailed && (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800" />
      )}

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Content */}
      <div className="relative z-10 w-full max-w-md px-4">
        {/* Branding */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-white">
            Carbitrage
          </h1>
          <p className="text-sm text-white/50 mt-1 tracking-wide">
            powered by <span className="text-white/70">CarOogle AI</span>
          </p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-white/10 bg-black/50 backdrop-blur-xl p-6 shadow-2xl">
          <div className="text-center mb-5">
            <h2 className="text-lg font-semibold text-white">Sign in to your account</h2>
            <p className="text-sm text-white/40 mt-0.5">Access your dealer intelligence</p>
          </div>

          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2 mb-4 bg-white/5 border border-white/10">
              <TabsTrigger value="login" className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-white/50">Sign In</TabsTrigger>
              <TabsTrigger value="signup" className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-white/50">Create Account</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
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
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-email" className="text-white/70 text-sm">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    disabled={loading}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/20"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password" className="text-white/70 text-sm">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    minLength={6}
                    required
                    disabled={loading}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/20"
                  />
                </div>
                <Button type="submit" className="w-full bg-white/10 hover:bg-white/20 text-white border border-white/10" disabled={loading}>
                  {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account...</> : 'Create Account'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>

        <p className="text-center text-xs text-white/20 mt-6">Automotive Truth</p>
      </div>
    </div>
  );
}
