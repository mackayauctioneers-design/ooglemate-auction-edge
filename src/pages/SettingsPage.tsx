import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { LogOut } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function SettingsPage() {
  const { user, currentUser, signOut } = useAuth();
  const [sub, setSub] = useState<any>(null);
  const [settings, setSettings] = useState({
    push_enabled: false,
    email_enabled: false,
    sms_enabled: false,
    quiet_hours_start: 19,
    quiet_hours_end: 7,
    phone: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;

    supabase
      .from('subscriptions')
      .select('plan_id, status, current_period_end')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (data) setSub(data); });

    supabase
      .from('dealer_settings')
      .select('*')
      .eq('user_id', user.id)
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          setSettings({
            push_enabled: data.push_enabled,
            email_enabled: data.email_enabled,
            sms_enabled: data.sms_enabled,
            quiet_hours_start: data.quiet_hours_start ?? 19,
            quiet_hours_end: data.quiet_hours_end ?? 7,
            phone: data.phone || '',
          });
        }
      });
  }, [user]);

  const saveSettings = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from('dealer_settings')
      .update(settings)
      .eq('user_id', user.id);

    if (error) toast.error('Failed to save');
    else toast.success('Settings saved');
    setSaving(false);
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>

        {/* Profile */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Profile</h2>
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-sm text-muted-foreground">Email</p>
            <p className="text-foreground">{user?.email}</p>
            <p className="text-sm text-muted-foreground mt-3">Dealer</p>
            <p className="text-foreground">{currentUser?.dealer_name || 'Not linked'}</p>
          </div>
        </section>

        {/* Subscription */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Subscription</h2>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-foreground capitalize">{sub?.plan_id || 'Starter'}</p>
                <p className="text-sm text-muted-foreground">
                  {sub?.status === 'active' ? 'Active' : sub?.status || 'Active'}
                  {sub?.current_period_end && ` · Renews ${new Date(sub.current_period_end).toLocaleDateString()}`}
                </p>
              </div>
              <Link to="/pricing">
                <Button variant="outline" size="sm">
                  {sub?.plan_id === 'starter' ? 'Upgrade' : 'Change Plan'}
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Notifications */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Notifications</h2>
          <div className="rounded-lg border border-border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between">
              <Label>Push notifications</Label>
              <Switch
                checked={settings.push_enabled}
                onCheckedChange={(v) => setSettings({ ...settings, push_enabled: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Email alerts</Label>
              <Switch
                checked={settings.email_enabled}
                onCheckedChange={(v) => setSettings({ ...settings, email_enabled: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>SMS alerts</Label>
              <Switch
                checked={settings.sms_enabled}
                onCheckedChange={(v) => setSettings({ ...settings, sms_enabled: v })}
              />
            </div>
            <div className="space-y-2">
              <Label>Phone number (for SMS)</Label>
              <Input
                value={settings.phone}
                onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                placeholder="+61 4XX XXX XXX"
              />
            </div>
            <Button onClick={saveSettings} disabled={saving}>
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </section>

        {/* Sign Out */}
        <Button variant="outline" className="w-full" onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sign Out
        </Button>
      </div>
    </AppLayout>
  );
}
