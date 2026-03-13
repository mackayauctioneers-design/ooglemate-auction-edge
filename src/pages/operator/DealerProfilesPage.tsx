import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OperatorLayout } from '@/components/layout/OperatorLayout';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, Globe, MapPin, Fingerprint, Package, ChevronDown, ChevronUp, Rocket, Loader2, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';

interface DealerProfile {
  id: string;
  dealer_name: string;
  dealer_website: string | null;
  dealer_email: string | null;
  dealer_phone: string | null;
  region_id: string;
  created_at: string;
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
}

interface DealerWithFingerprints extends DealerProfile {
  fingerprints: DealerFingerprint[];
}

export default function DealerProfilesPage() {
  const navigate = useNavigate();
  const [dealers, setDealers] = useState<DealerWithFingerprints[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [profilingIds, setProfilingIds] = useState<Set<string>>(new Set());

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
      supabase.from('dealer_fingerprints').select('*').order('make, model'),
    ]);

    const profiles = (profilesRes.data || []) as DealerProfile[];
    const fingerprints = (fingerprintsRes.data || []) as DealerFingerprint[];

    // Group fingerprints by dealer_profile_id and dealer_name
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
      fingerprints:
        fpByProfileId.get(p.id) ||
        fpByName.get(p.dealer_name.toLowerCase()) ||
        [],
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

  return (
    <OperatorLayout>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dealer Profiles</h1>
          <p className="text-muted-foreground mt-1">
            {dealers.length} dealers · {totalFingerprints} fingerprints
          </p>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading…</div>
        ) : dealers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No dealers onboarded yet. Head to{' '}
              <a href="/operator/dealers" className="text-primary underline">
                Dealer Management
              </a>{' '}
              to add one.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {dealers.map((dealer) => {
              const isOpen = expandedIds.has(dealer.id);
              const makes = [...new Set(dealer.fingerprints.map((f) => f.make))];
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
                                {dealer.dealer_website && (
                                  <>
                                    <span>·</span>
                                    <Globe className="h-3 w-3" />
                                    <span className="truncate max-w-[200px]">
                                      {dealer.dealer_website.replace(/^https?:\/\//, '')}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {makes.length > 0 ? (
                              <div className="hidden sm:flex gap-1">
                                {makes.slice(0, 3).map((m) => (
                                  <Badge key={m} variant="secondary" className="text-xs">
                                    {m}
                                  </Badge>
                                ))}
                                {makes.length > 3 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{makes.length - 3}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                No fingerprints
                              </Badge>
                            )}
                            {isOpen ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
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
                                <a
                                  href={dealer.dealer_website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary underline truncate block"
                                >
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

                        {/* Fingerprints */}
                        {hasFingerprints ? (
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <Fingerprint className="h-4 w-4 text-primary" />
                              <span className="text-sm font-medium flex-1">
                                Fingerprints ({dealer.fingerprints.length})
                              </span>
                              {dealer.dealer_website && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="gap-1.5 text-xs h-7"
                                  disabled={profilingIds.has(dealer.id)}
                                  onClick={(e) => { e.stopPropagation(); triggerProfiling(dealer); }}
                                >
                                  {profilingIds.has(dealer.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
                                  Re-profile
                                </Button>
                              )}
                            </div>
                            <div className="border rounded-lg overflow-hidden">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="bg-muted/50 text-muted-foreground text-xs">
                                    <th className="text-left px-3 py-2 font-medium">Make</th>
                                    <th className="text-left px-3 py-2 font-medium">Model</th>
                                    <th className="text-left px-3 py-2 font-medium">Years</th>
                                    <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">KM Range</th>
                                    <th className="text-left px-3 py-2 font-medium">Source</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {dealer.fingerprints.map((fp) => (
                                    <tr key={fp.id} className="hover:bg-muted/30">
                                      <td className="px-3 py-2 font-medium">{fp.make}</td>
                                      <td className="px-3 py-2">{fp.model}</td>
                                      <td className="px-3 py-2 text-muted-foreground">
                                        {fp.year_min}–{fp.year_max}
                                      </td>
                                      <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                                        {fp.min_km && fp.max_km
                                          ? `${(fp.min_km / 1000).toFixed(0)}k – ${(fp.max_km / 1000).toFixed(0)}k`
                                          : '—'}
                                      </td>
                                      <td className="px-3 py-2">
                                        <Badge
                                          variant={fp.is_spec_only ? 'outline' : 'default'}
                                          className="text-xs"
                                        >
                                          {fp.is_spec_only ? 'CaroogleAI' : 'Sales'}
                                        </Badge>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 text-sm text-muted-foreground bg-muted/30 rounded-lg px-4 py-3">
                            <Package className="h-4 w-4" />
                            <span className="flex-1">No fingerprints yet</span>
                            {dealer.dealer_website && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
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
