import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, RefreshCw, Save, Trash2, Plus, ArrowLeft, Mail, Upload, Sparkles } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
import { DealerStrategicProfileCard } from '@/components/operator/DealerStrategicProfileCard';


type WeightsShape = { MAKE: Record<string, number>; MAKE_MODEL: Record<string, number> };

interface Profile {
  account_id: string;
  master_brief_md: string;
  auto_summary: any;
  weights: WeightsShape;
  weights_source: 'manual' | 'auto' | 'blended';
  last_rebuilt_at: string | null;
}

export default function DealerMasterProfilePage() {
  const { accountId } = useParams<{ accountId: string }>();
  const [accountName, setAccountName] = useState<string>('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [arbyRunning, setArbyRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reAnalyzeWithArby = async () => {
    if (!accountId) return;
    setArbyRunning(true);
    try {
      const { data: dp, error: dpErr } = await supabase
        .from('dealer_profiles')
        .select('id, dealer_name, dealer_website, dealer_email')
        .eq('account_id', accountId)
        .maybeSingle();
      if (dpErr) throw dpErr;
      if (!dp?.dealer_website) {
        toast.error('No dealer website on file — add one to dealer_profiles first');
        return;
      }
      const { data, error } = await supabase.functions.invoke('dealer-onboard-dispatch', {
        body: {
          dealer_profile_id: dp.id,
          dealer_name: dp.dealer_name || accountName,
          dealer_website: dp.dealer_website,
          dealer_email: dp.dealer_email,
          scope: ['inventory', 'days_in_stock', 'business_analysis'],
        },
      });
      if (error) throw error;
      toast.success(`Arby dispatched — fresh deep-dive queued. Results will post back automatically.`);
      console.log('[arby-dispatch]', data);
    } catch (e: any) {
      toast.error(e.message || 'Arby dispatch failed');
    } finally {
      setArbyRunning(false);
    }
  };

  const handleBriefUpload = async (file: File, mode: 'append' | 'replace') => {
    if (!profile) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error('File too large (max 15MB)');
      return;
    }
    setUploading(true);
    try {
      // Read file as base64
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const data_base64 = btoa(bin);

      const { data, error } = await supabase.functions.invoke('extract-dealer-brief', {
        body: { file_name: file.name, mime_type: file.type || 'application/octet-stream', data_base64 },
      });
      if (error) throw error;
      const md = (data as any)?.markdown as string;
      if (!md) throw new Error('No markdown returned');

      const next = mode === 'replace' || !profile.master_brief_md
        ? md
        : `${profile.master_brief_md.trimEnd()}\n\n---\n\n## From ${file.name}\n\n${md}`;
      setProfile({ ...profile, master_brief_md: next });
      toast.success(`Brief ${mode === 'replace' ? 'replaced' : 'updated'} from ${file.name} — review and save`);
    } catch (e: any) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (!accountId) return;
    (async () => {
      setLoading(true);
      const [{ data: acct }, { data: prof }] = await Promise.all([
        supabase.from('accounts').select('display_name').eq('id', accountId).maybeSingle(),
        supabase.from('dealer_intelligence_profiles').select('*').eq('account_id', accountId).maybeSingle(),
      ]);
      setAccountName(acct?.display_name || 'Unknown dealer');
      setProfile(prof ? {
        ...prof,
        weights: (prof.weights as WeightsShape) ?? { MAKE: {}, MAKE_MODEL: {} },
        weights_source: (prof.weights_source as Profile['weights_source']) ?? 'blended',
      } : {
        account_id: accountId,
        master_brief_md: '',
        auto_summary: {},
        weights: { MAKE: {}, MAKE_MODEL: {} },
        weights_source: 'blended',
        last_rebuilt_at: null,
      });
      setLoading(false);
    })();
  }, [accountId]);

  const save = async () => {
    if (!profile || !accountId) return;
    setSaving(true);
    const { error } = await supabase
      .from('dealer_intelligence_profiles')
      .upsert({
        account_id: accountId,
        master_brief_md: profile.master_brief_md,
        weights: profile.weights,
        weights_source: profile.weights_source,
      }, { onConflict: 'account_id' });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success('Profile saved — scorer will pick up weights on next run');
  };

  const rebuild = async () => {
    if (!accountId) return;
    setRebuilding(true);
    const { data, error } = await supabase.functions.invoke('rebuild-dealer-intelligence', {
      body: { account_id: accountId },
    });
    setRebuilding(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Rebuilt — ${data?.result?.winners ?? 0} winners, ${data?.result?.avoid ?? 0} avoid`);
    const { data: prof } = await supabase
      .from('dealer_intelligence_profiles').select('*').eq('account_id', accountId).maybeSingle();
    if (prof) setProfile({ ...prof, weights: (prof.weights as WeightsShape) ?? { MAKE: {}, MAKE_MODEL: {} }, weights_source: (prof.weights_source as Profile['weights_source']) ?? 'blended' });
  };

  const updateWeight = (scope: 'MAKE' | 'MAKE_MODEL', key: string, value: number) => {
    if (!profile) return;
    const next = { ...profile.weights, [scope]: { ...profile.weights[scope], [key]: value } };
    setProfile({ ...profile, weights: next });
  };

  const removeWeight = (scope: 'MAKE' | 'MAKE_MODEL', key: string) => {
    if (!profile) return;
    const copy = { ...profile.weights[scope] };
    delete copy[key];
    setProfile({ ...profile, weights: { ...profile.weights, [scope]: copy } });
  };

  const addWeight = (scope: 'MAKE' | 'MAKE_MODEL') => {
    if (!profile) return;
    const key = prompt(scope === 'MAKE' ? 'Make (e.g. TOYOTA)' : 'MAKE|MODEL (e.g. TOYOTA|HILUX)');
    if (!key) return;
    updateWeight(scope, key.toUpperCase(), 1.0);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!profile) return null;

  const summary = profile.auto_summary || {};
  const winners: any[] = summary.winners || [];
  const avoid: any[] = summary.avoid || [];

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/operator/dealers" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Dealers
          </Link>
          <h1 className="text-2xl font-bold text-foreground mt-1">{accountName} — Master Profile</h1>
          <p className="text-sm text-muted-foreground">
            Manual brief + sales-truth synthesis → make/model weights applied to the scorer.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              const email = prompt(`Invite a user to access ${accountName}'s Trading Desk.\nEnter their email:`);
              if (!email) return;
              const dealer_name = prompt('Their name (optional)') || null;
              const { data, error } = await supabase.functions.invoke('invite-dealer', {
                body: { account_id: accountId, email: email.trim(), dealer_name },
              });
              if (error) { toast.error(error.message); return; }
              const d = data as any;
              const loginText = `Login: ${d.login_url || `${window.location.origin}/auth`}
Email: ${d.email || email.trim()}
Temporary password: ${d.temporary_password}`;
              try { await navigator.clipboard.writeText(loginText); } catch {}
              toast.success(`Simple login created for ${email}. Credentials copied to clipboard.`, { duration: 8000 });
              window.prompt('Send these login details to the dealer:', loginText);
            }}
          >
            <Mail className="h-4 w-4 mr-2" /> Create Login
          </Button>
          <Button onClick={reAnalyzeWithArby} disabled={arbyRunning} variant="outline">
            {arbyRunning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Re-analyze with Arby
          </Button>
          <Button onClick={rebuild} disabled={rebuilding} variant="outline">
            {rebuilding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Rebuild from sales
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Master brief */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle>Master Brief</CardTitle>
                <CardDescription>Deep-research write-up (paste or upload PDF / DOCX / TXT / MD)</CardDescription>
              </div>
              <div className="flex flex-col gap-1 items-end">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,.md,.markdown,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const mode = profile.master_brief_md.trim()
                      ? (confirm(`Append "${f.name}" to the existing brief?\n\nClick Cancel to REPLACE the brief instead.`) ? 'append' : 'replace')
                      : 'replace';
                    handleBriefUpload(f, mode);
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading
                    ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Parsing…</>
                    : <><Upload className="h-3 w-3 mr-1" />Upload file</>}
                </Button>
                <span className="text-[10px] text-muted-foreground">PDF · DOCX · TXT · MD (max 15MB)</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Textarea
              value={profile.master_brief_md}
              onChange={(e) => setProfile({ ...profile, master_brief_md: e.target.value })}
              className="font-mono text-xs min-h-[400px]"
              placeholder="# Dealer Profile&#10;&#10;## Winners&#10;- ...&#10;&#10;## Avoid&#10;- ...&#10;&#10;## Niches&#10;- ..."
            />
          </CardContent>
        </Card>

        {/* Auto summary */}
        <Card>
          <CardHeader>
            <CardTitle>Sales-Truth Summary</CardTitle>
            <CardDescription>
              {summary.total_sales ? (
                <>From {summary.total_sales} sales (last {summary.lookback_months}mo) · avg margin ${summary.avg_margin?.toLocaleString()} · avg days {summary.avg_days_to_clear ?? '—'}</>
              ) : 'No summary yet — click Rebuild from sales'}
              {profile.last_rebuilt_at && <span className="block text-xs mt-1">Last rebuilt: {new Date(profile.last_rebuilt_at).toLocaleString()}</span>}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-emerald-600 mb-2">Winners ({winners.length})</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {winners.map((w) => (
                  <div key={w.key} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-emerald-500/5">
                    <span className="font-mono">{w.key}</span>
                    <span className="text-muted-foreground">{w.sales} sales · ${w.avg_margin}/avg · {w.avg_days_to_clear ?? '—'}d</span>
                    <Badge variant="outline" className="text-emerald-600 border-emerald-600/40">×{w.weight}</Badge>
                  </div>
                ))}
                {winners.length === 0 && <p className="text-xs text-muted-foreground">None identified yet.</p>}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-amber-600 mb-2">Avoid ({avoid.length})</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {avoid.map((w) => (
                  <div key={w.key} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-amber-500/5">
                    <span className="font-mono">{w.key}</span>
                    <span className="text-muted-foreground">{w.sales} sales · ${w.avg_margin}/avg · {w.avg_days_to_clear ?? '—'}d</span>
                    <Badge variant="outline" className="text-amber-600 border-amber-600/40">×{w.weight}</Badge>
                  </div>
                ))}
                {avoid.length === 0 && <p className="text-xs text-muted-foreground">None identified yet.</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Weights editor */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Scorer Weights</CardTitle>
              <CardDescription>Multiplier applied to expected margin. 1.0 = neutral · 0–2 range</CardDescription>
            </div>
            <Select value={profile.weights_source} onValueChange={(v: any) => setProfile({ ...profile, weights_source: v })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto only</SelectItem>
                <SelectItem value="manual">Manual only</SelectItem>
                <SelectItem value="blended">Blended (manual wins)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {(['MAKE', 'MAKE_MODEL'] as const).map((scope) => (
            <div key={scope}>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold">{scope === 'MAKE' ? 'By Make' : 'By Make + Model'}</h4>
                <Button size="sm" variant="ghost" onClick={() => addWeight(scope)}><Plus className="h-3 w-3 mr-1" />Add</Button>
              </div>
              <div className="space-y-1">
                {Object.entries(profile.weights[scope] || {}).sort().map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="font-mono text-xs flex-1 truncate">{k}</span>
                    <Input
                      type="number" step="0.1" min={0} max={2}
                      value={v}
                      onChange={(e) => updateWeight(scope, k, parseFloat(e.target.value) || 0)}
                      className="w-20 h-8 text-xs"
                    />
                    <Button size="sm" variant="ghost" onClick={() => removeWeight(scope, k)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {Object.keys(profile.weights[scope] || {}).length === 0 && (
                  <p className="text-xs text-muted-foreground">No weights — all neutral (×1.0).</p>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
