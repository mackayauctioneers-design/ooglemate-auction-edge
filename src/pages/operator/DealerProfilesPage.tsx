import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, Globe, MapPin, Fingerprint, Package, ChevronDown, ChevronUp, Rocket, Loader2, BarChart3, Shield, Eye, AlertTriangle, Target, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface DealerProfile {
  id: string;
  dealer_name: string;
  dealer_website: string | null;
  dealer_email: string | null;
  dealer_phone: string | null;
  region_id: string;
  created_at: string;
  account_id: string | null;
}

interface DealerFingerprint {
  id: string;
  fingerprint_id: string;
  dealer_profile_id: string | null;
  dealer_name: string;
  make: string;
  model: string;
  year_min: number;
  year_max: number;
  min_km: number | null;
  max_km: number | null;
  is_active: boolean;
  is_spec_only: boolean;
  created_at: string;
  fingerprint_priority: string;
  fingerprint_type: string;
  profit_score: number | null;
  avg_profit: number | null;
  sales_count: number | null;
  alert_enabled: boolean;
  avg_days_to_sell: number | null;
}

interface DealerWithFingerprints extends DealerProfile {
  fingerprints: DealerFingerprint[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);

const priorityConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  high: { label: 'HIGH', color: 'text-green-700', bgColor: 'bg-green-100 border-green-200' },
  medium: { label: 'MED', color: 'text-amber-700', bgColor: 'bg-amber-100 border-amber-200' },
  low: { label: 'LOW', color: 'text-muted-foreground', bgColor: 'bg-muted border-border' },
};

export default function DealerProfilesPage() {
  const navigate = useNavigate();
  const [dealers, setDealers] = useState<DealerWithFingerprints[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [profilingIds, setProfilingIds] = useState<Set<string>>(new Set());
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());

  const buildAccountSlug = (dealer: DealerWithFingerprints) => {
    const base = dealer.dealer_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    return base || `dealer-${dealer.id.slice(0, 8)}`;
  };

  const openSalesUpload = async (dealer: DealerWithFingerprints) => {
    setUploadingIds((prev) => new Set(prev).add(dealer.id));

    try {
      let accountId = dealer.account_id;

      if (!accountId) {
        const baseSlug = buildAccountSlug(dealer);

        let { data: account, error: accountError } = await supabase
          .from('accounts')
          .insert({
            display_name: dealer.dealer_name,
            slug: baseSlug,
          })
          .select('id')
          .single();

        if (accountError?.code === '23505') {
          ({ data: account, error: accountError } = await supabase
            .from('accounts')
            .insert({
              display_name: dealer.dealer_name,
              slug: `${baseSlug}-${dealer.id.slice(0, 8)}`,
            })
            .select('id')
            .single());
        }

        if (accountError || !account) {
          throw accountError || new Error('Failed to create account');
        }

        accountId = account.id;

        const { error: profileError } = await supabase
          .from('dealer_profiles')
          .update({ account_id: accountId } as never)
          .eq('id', dealer.id);

        if (profileError) throw profileError;

        setDealers((prev) => prev.map((item) => (
          item.id === dealer.id ? { ...item, account_id: accountId } : item
        )));

        toast.success(`Sales upload ready for ${dealer.dealer_name}`);
      }

      navigate(`/operator/dealer-upload?account=${accountId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err as any)?.message || JSON.stringify(err);
      toast.error('Could not open sales upload: ' + msg);
    } finally {
      setUploadingIds((prev) => {
        const next = new Set(prev);
        next.delete(dealer.id);
        return next;
      });
    }
  };

  const triggerProfiling = async (dealer: DealerWithFingerprints) => {
    if (!dealer.dealer_website) {
      toast.error('No website on file — cannot profile');
      return;
    }
    setProfilingIds((prev) => new Set(prev).add(dealer.id));
    try {
      const { error } = await supabase.functions.invoke('dealer-onboard-dispatch', {
        body: {
          dealer_profile_id: dealer.id,
          dealer_name: dealer.dealer_name,
          dealer_website: dealer.dealer_website,
          dealer_email: dealer.dealer_email || undefined,
        },
      });
      if (error) throw error;
      toast.success(`🤖 CaroogleAI dispatched for ${dealer.dealer_name}`);
    } catch (err) {
      toast.error('Dispatch failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setProfilingIds((prev) => {
        const next = new Set(prev);
        next.delete(dealer.id);
        return next;
      });
    }
  };

  useEffect(() => {
    document.title = 'Dealer Profiles | Operator';
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [profilesRes, fingerprintsRes] = await Promise.all([
      supabase.from('dealer_profiles').select('*').order('dealer_name'),
      supabase.from('dealer_fingerprints').select('*').order('profit_score', { ascending: false, nullsFirst: false }),
    ]);

    const profiles = (profilesRes.data || []) as DealerProfile[];
    const fingerprints = (fingerprintsRes.data || []) as DealerFingerprint[];

    const fpByProfileId = new Map<string, DealerFingerprint[]>();
    const fpByName = new Map<string, DealerFingerprint[]>();
    for (const fp of fingerprints) {
      if (fp.dealer_profile_id) {
        const arr = fpByProfileId.get(fp.dealer_profile_id) || [];
        arr.push(fp);
        fpByProfileId.set(fp.dealer_profile_id, arr);
      }
      const nameKey = fp.dealer_name.toLowerCase();
      const arr2 = fpByName.get(nameKey) || [];
      arr2.push(fp);
      fpByName.set(nameKey, arr2);
    }

    const merged: DealerWithFingerprints[] = profiles.map((p) => ({
      ...p,
      fingerprints: fpByProfileId.get(p.id) || fpByName.get(p.dealer_name.toLowerCase()) || [],
    }));

    setDealers(merged);
    setLoading(false);
  };

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const totalFingerprints = dealers.reduce((s, d) => s + d.fingerprints.length, 0);
  const activeAlerts = dealers.reduce((s, d) => s + d.fingerprints.filter(f => f.alert_enabled).length, 0);

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dealer Profiles</h1>
          <p className="text-muted-foreground mt-1">
            {dealers.length} dealers · {totalFingerprints} fingerprints · {activeAlerts} active alerts
          </p>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading…</div>
        ) : dealers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No dealers onboarded yet. Head to{' '}
              <a href="/operator/dealers" className="text-primary underline">Dealer Management</a>{' '}
              to add one.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {dealers.map((dealer) => {
              const isOpen = expandedIds.has(dealer.id);
              const highFps = dealer.fingerprints.filter(f => f.fingerprint_priority === 'high');
              const medFps = dealer.fingerprints.filter(f => f.fingerprint_priority === 'medium' && f.fingerprint_type === 'dealer_trade');
              const lowFps = dealer.fingerprints.filter(f => f.fingerprint_priority === 'low' || f.fingerprint_type === 'wholesale');
              const hasFingerprints = dealer.fingerprints.length > 0;

              return (
                <Card key={dealer.id} className="overflow-hidden">
                  <Collapsible open={isOpen} onOpenChange={() => toggle(dealer.id)}>
                    <CollapsibleTrigger asChild>
                      <button className="w-full text-left">
                        <CardHeader className="py-4 px-5 flex flex-row items-center justify-between gap-4 hover:bg-muted/40 transition-colors">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <Building2 className="h-5 w-5 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <CardTitle className="text-base truncate">{dealer.dealer_name}</CardTitle>
                              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                                <MapPin className="h-3 w-3" />
                                <span>{dealer.region_id.replace(/_/g, ' ')}</span>
                                {dealer.dealer_website ? (
                                  <>
                                    <span>·</span>
                                    <Globe className="h-3 w-3" />
                                    <span className="truncate max-w-[200px]">
                                      {dealer.dealer_website.replace(/^https?:\/\//, '')}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span>·</span>
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">Independent</Badge>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {highFps.length > 0 && (
                              <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                                <Shield className="h-3 w-3 mr-1" />
                                {highFps.length} Active
                              </Badge>
                            )}
                            {lowFps.length > 0 && (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                {lowFps.length} Passive
                              </Badge>
                            )}
                            {!hasFingerprints && (
                              <Badge variant="outline" className="text-xs text-muted-foreground">No fingerprints</Badge>
                            )}
                            {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                          </div>
                        </CardHeader>
                      </button>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <CardContent className="pt-0 pb-4 px-5 space-y-4">
                        {/* Contact info */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                          {dealer.dealer_website && (
                            <div>
                              <span className="text-muted-foreground text-xs">Website</span>
                              <p>
                                <a href={dealer.dealer_website} target="_blank" rel="noopener noreferrer" className="text-primary underline truncate block">
                                  {dealer.dealer_website.replace(/^https?:\/\//, '')}
                                </a>
                              </p>
                            </div>
                          )}
                          {dealer.dealer_email && (
                            <div>
                              <span className="text-muted-foreground text-xs">Email</span>
                              <p>{dealer.dealer_email}</p>
                            </div>
                          )}
                          {dealer.dealer_phone && (
                            <div>
                              <span className="text-muted-foreground text-xs">Phone</span>
                              <p>{dealer.dealer_phone}</p>
                            </div>
                          )}
                          <div>
                            <span className="text-muted-foreground text-xs">Region</span>
                            <p>{dealer.region_id.replace(/_/g, ' ')}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-xs">Added</span>
                            <p>{new Date(dealer.created_at).toLocaleDateString()}</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            className="gap-2"
                            disabled={uploadingIds.has(dealer.id)}
                            onClick={(e) => {
                              e.stopPropagation();
                              void openSalesUpload(dealer);
                            }}
                          >
                            {uploadingIds.has(dealer.id) ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Upload className="h-4 w-4" />
                            )}
                            Upload Sales
                          </Button>
                        </div>

                        {/* Report Link */}
                        {dealer.dealer_name.toLowerCase().includes('ajh') && (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm" variant="outline" className="gap-2"
                              onClick={(e) => { e.stopPropagation(); navigate('/dealer/report/ajh'); }}
                            >
                              <BarChart3 className="h-4 w-4" /> Intelligence Report
                            </Button>
                            <Button
                              size="sm" className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                              onClick={(e) => { e.stopPropagation(); navigate('/dealer/opportunities/ajh'); }}
                            >
                              <Target className="h-4 w-4" /> Opportunity Feed
                            </Button>
                          </div>
                        )}

                        {/* Tiered Fingerprints */}
                        {hasFingerprints ? (
                          <div className="space-y-4">
                            {/* HIGH — Active Alerts */}
                            {highFps.length > 0 && (
                              <FingerprintTier
                                title="Dealer Trade — Active Alerts"
                                icon={<Shield className="h-4 w-4 text-green-600" />}
                                badgeClass="bg-green-100 text-green-700 border-green-200"
                                fingerprints={highFps}
                                showProfit
                              />
                            )}

                            {/* MEDIUM — Watch List */}
                            {medFps.length > 0 && (
                              <FingerprintTier
                                title="Dealer Trade — Watch List"
                                icon={<Eye className="h-4 w-4 text-amber-600" />}
                                badgeClass="bg-amber-100 text-amber-700 border-amber-200"
                                fingerprints={medFps}
                                showProfit
                              />
                            )}

                            {/* LOW — Background Data */}
                            {lowFps.length > 0 && (
                              <FingerprintTier
                                title="Wholesale — Background Data"
                                icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
                                badgeClass="bg-muted text-muted-foreground border-border"
                                fingerprints={lowFps}
                                showProfit={false}
                                collapsed
                              />
                            )}

                            {dealer.dealer_website && (
                              <Button
                                size="sm" variant="ghost" className="gap-1.5 text-xs h-7"
                                disabled={profilingIds.has(dealer.id)}
                                onClick={(e) => { e.stopPropagation(); triggerProfiling(dealer); }}
                              >
                                {profilingIds.has(dealer.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                                Re-profile
                              </Button>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 text-sm text-muted-foreground bg-muted/30 rounded-lg px-4 py-3">
                            <Package className="h-4 w-4" />
                            <span className="flex-1">No fingerprints yet</span>
                            {dealer.dealer_website && (
                              <Button
                                size="sm" variant="outline" className="gap-1.5"
                                disabled={profilingIds.has(dealer.id)}
                                onClick={(e) => { e.stopPropagation(); triggerProfiling(dealer); }}
                              >
                                {profilingIds.has(dealer.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                                Profile Now
                              </Button>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </OperatorLayout>
  );
}

function FingerprintTier({
  title,
  icon,
  badgeClass,
  fingerprints,
  showProfit,
  collapsed = false,
}: {
  title: string;
  icon: React.ReactNode;
  badgeClass: string;
  fingerprints: DealerFingerprint[];
  showProfit: boolean;
  collapsed?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(!collapsed);

  return (
    <div>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-2 mb-2 hover:opacity-80 transition-opacity">
            {icon}
            <span className="text-sm font-medium flex-1 text-left">{title}</span>
            <Badge variant="outline" className={cn("text-xs", badgeClass)}>{fingerprints.length}</Badge>
            {isOpen ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground text-xs">
                  <th className="text-left px-3 py-2 font-medium">Make</th>
                  <th className="text-left px-3 py-2 font-medium">Model</th>
                  <th className="text-left px-3 py-2 font-medium">Years</th>
                  <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">KM Range</th>
                  {showProfit && (
                    <>
                      <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Avg Profit</th>
                      <th className="text-right px-3 py-2 font-medium hidden md:table-cell">Total Profit</th>
                      <th className="text-right px-3 py-2 font-medium hidden md:table-cell">Sales</th>
                      <th className="text-right px-3 py-2 font-medium hidden lg:table-cell">Avg Days</th>
                    </>
                  )}
                  <th className="text-left px-3 py-2 font-medium">Alert</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {fingerprints.map((fp) => (
                  <tr key={fp.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{fp.make}</td>
                    <td className="px-3 py-2">{fp.model}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fp.year_min}–{fp.year_max}</td>
                    <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                      {fp.min_km && fp.max_km
                        ? `${(fp.min_km / 1000).toFixed(0)}k – ${(fp.max_km / 1000).toFixed(0)}k`
                        : '—'}
                    </td>
                    {showProfit && (
                      <>
                        <td className="px-3 py-2 text-right hidden sm:table-cell font-medium" style={{ color: (fp.avg_profit ?? 0) >= 0 ? 'hsl(142, 71%, 45%)' : 'hsl(0, 84%, 60%)' }}>
                          {fp.avg_profit != null ? fmt(fp.avg_profit) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right hidden md:table-cell text-muted-foreground">
                          {fp.profit_score != null ? fmt(fp.profit_score) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right hidden md:table-cell text-muted-foreground">
                          {fp.sales_count ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-right hidden lg:table-cell text-muted-foreground">
                          {fp.avg_days_to_sell != null ? `${fp.avg_days_to_sell}d` : '—'}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2">
                      {fp.alert_enabled ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">ON</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">OFF</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
