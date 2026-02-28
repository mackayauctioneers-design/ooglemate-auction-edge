import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, CheckCircle2, Clock, ExternalLink,
  RefreshCw, Target, TrendingUp, XCircle, ChevronRight,
  DollarSign, Zap, Shield,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Instruction {
  id: string;
  listing_id: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  trim: string | null;
  source: string | null;
  auction_house: string | null;
  listing_url: string | null;
  sale_close_at: string | null;
  target_acquisition_price: number | null;
  expected_gross: number | null;
  expected_days_to_sell: number | null;
  score: number | null;
  notes: string | null;
  priority: 'critical' | 'high' | 'normal';
  no_reserve: boolean;
  has_damage: boolean;
  status: 'pending' | 'acknowledged' | 'bid_placed' | 'won' | 'lost' | 'passed' | 'expired';
  acknowledged_at: string | null;
  bid_amount: number | null;
  created_at: string;
}

// ─── Priority badge ───────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: Instruction['priority'] }) {
  const map = {
    critical: { label: 'CRITICAL', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
    high:     { label: 'HIGH',     className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    normal:   { label: 'NORMAL',   className: 'bg-white/10 text-white/60 border-white/20' },
  };
  const { label, className } = map[priority];
  return <span className={cn('text-[10px] font-bold tracking-widest px-2 py-0.5 rounded border', className)}>{label}</span>;
}

// ─── Countdown ───────────────────────────────────────────────────────────────

function Countdown({ closeAt }: { closeAt: string | null }) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!closeAt) { setLabel('TBC'); return; }
    const update = () => {
      const diff = new Date(closeAt).getTime() - Date.now();
      if (diff <= 0) { setLabel('CLOSED'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setLabel(h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [closeAt]);
  const isUrgent = closeAt && new Date(closeAt).getTime() - Date.now() < 3600000;
  return (
    <span className={cn('font-mono text-sm font-semibold', isUrgent ? 'text-red-400' : 'text-white/70')}>
      <Clock className="inline h-3 w-3 mr-1 mb-0.5" />{label}
    </span>
  );
}

// ─── Instruction Card ─────────────────────────────────────────────────────────

function InstructionCard({
  instruction,
  onAction,
}: {
  instruction: Instruction;
  onAction: (id: string, action: string, data?: Record<string, unknown>) => void;
}) {
  const [bidInput, setBidInput] = useState('');
  const [showBid, setShowBid] = useState(false);

  const isActive = ['pending', 'acknowledged'].includes(instruction.status);
  const isBidPlaced = instruction.status === 'bid_placed';

  return (
    <Card className={cn(
      'bg-white/[0.03] border transition-all duration-200',
      instruction.priority === 'critical' && 'border-red-500/40 shadow-red-500/10 shadow-lg',
      instruction.priority === 'high' && 'border-amber-500/30',
      instruction.priority === 'normal' && 'border-white/10',
      !isActive && !isBidPlaced && 'opacity-50',
    )}>
      <CardContent className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <PriorityBadge priority={instruction.priority} />
              {instruction.no_reserve && (
                <span className="text-[10px] font-bold tracking-widest px-2 py-0.5 rounded border bg-emerald-500/20 text-emerald-400 border-emerald-500/30">NO RESERVE</span>
              )}
              {instruction.has_damage && (
                <span className="text-[10px] font-bold tracking-widest px-2 py-0.5 rounded border bg-orange-500/20 text-orange-400 border-orange-500/30">DAMAGE</span>
              )}
            </div>
            <h3 className="text-white font-semibold text-base leading-tight">
              {instruction.year} {instruction.make} {instruction.model}
              {instruction.trim && <span className="text-white/50 font-normal ml-1">{instruction.trim}</span>}
            </h3>
            <p className="text-white/50 text-sm mt-0.5">
              {instruction.km ? `${instruction.km.toLocaleString()} km` : '—'}
              {instruction.source && ` · ${instruction.source}`}
              {instruction.auction_house && ` · ${instruction.auction_house}`}
            </p>
          </div>
          <div className="text-right shrink-0">
            <Countdown closeAt={instruction.sale_close_at} />
            {instruction.sale_close_at && (
              <p className="text-white/30 text-xs mt-0.5">
                {format(new Date(instruction.sale_close_at), 'EEE d MMM, h:mma')}
              </p>
            )}
          </div>
        </div>

        {/* Financial strip */}
        <div className="grid grid-cols-3 gap-2 mb-3 p-3 rounded-lg bg-white/[0.04] border border-white/[0.06]">
          <div className="text-center">
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-0.5">Target Buy</p>
            <p className="text-white font-bold text-lg">
              {instruction.target_acquisition_price
                ? `$${instruction.target_acquisition_price.toLocaleString()}`
                : '—'}
            </p>
          </div>
          <div className="text-center border-x border-white/[0.08]">
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-0.5">Exp. Gross</p>
            <p className={cn('font-bold text-lg', instruction.expected_gross && instruction.expected_gross > 0 ? 'text-emerald-400' : 'text-white/50')}>
              {instruction.expected_gross
                ? `$${Math.round(instruction.expected_gross).toLocaleString()}`
                : '—'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-0.5">Days to Sell</p>
            <p className="text-white font-bold text-lg">
              {instruction.expected_days_to_sell
                ? `${Math.round(instruction.expected_days_to_sell)}d`
                : '—'}
            </p>
          </div>
        </div>

        {/* Score bar */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', instruction.score && instruction.score >= 75 ? 'bg-emerald-400' : instruction.score && instruction.score >= 50 ? 'bg-amber-400' : 'bg-white/30')}
              style={{ width: `${instruction.score || 0}%` }}
            />
          </div>
          <span className="text-white/40 text-xs font-mono">{instruction.score || 0}/100</span>
          {instruction.listing_url && (
            <a href={instruction.listing_url} target="_blank" rel="noopener noreferrer" className="text-white/40 hover:text-white transition-colors">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        {/* Action buttons */}
        {isActive && (
          <div className="flex gap-2 flex-wrap">
            {instruction.status === 'pending' && (
              <Button size="sm" variant="outline" className="border-white/20 text-white/70 hover:bg-white/10 text-xs"
                onClick={() => onAction(instruction.id, 'acknowledged')}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Acknowledge
              </Button>
            )}
            {!showBid ? (
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
                onClick={() => setShowBid(true)}>
                <DollarSign className="h-3.5 w-3.5 mr-1" /> Log Bid
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="Bid amount"
                  value={bidInput}
                  onChange={(e) => setBidInput(e.target.value)}
                  className="w-32 px-2 py-1 text-sm bg-white/10 border border-white/20 rounded text-white placeholder:text-white/30 focus:outline-none focus:border-white/40"
                />
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
                  onClick={() => { onAction(instruction.id, 'bid_placed', { bid_amount: parseFloat(bidInput) }); setShowBid(false); setBidInput(''); }}>
                  Confirm
                </Button>
                <Button size="sm" variant="ghost" className="text-white/40 text-xs" onClick={() => setShowBid(false)}>Cancel</Button>
              </div>
            )}
            <Button size="sm" variant="ghost" className="text-white/40 hover:text-white/60 text-xs"
              onClick={() => onAction(instruction.id, 'passed')}>
              Pass
            </Button>
          </div>
        )}

        {isBidPlaced && (
          <div className="flex gap-2 flex-wrap">
            <span className="text-white/50 text-sm">Bid: <strong className="text-white">${instruction.bid_amount?.toLocaleString()}</strong></span>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs ml-auto"
              onClick={() => onAction(instruction.id, 'won')}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Won
            </Button>
            <Button size="sm" variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs"
              onClick={() => onAction(instruction.id, 'lost')}>
              <XCircle className="h-3.5 w-3.5 mr-1" /> Lost
            </Button>
          </div>
        )}

        {['won', 'lost', 'passed', 'expired'].includes(instruction.status) && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn(
              instruction.status === 'won' ? 'border-emerald-500/40 text-emerald-400' :
              instruction.status === 'lost' ? 'border-red-500/40 text-red-400' :
              'border-white/20 text-white/40'
            )}>
              {instruction.status.toUpperCase()}
            </Badge>
            {instruction.bid_amount && <span className="text-white/40 text-xs">Bid: ${instruction.bid_amount.toLocaleString()}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BuyerTerminalPage() {
  const { user } = useAuth();
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'active' | 'bid_placed' | 'completed'>('active');
  const realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchInstructions = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('fleet_buyer_instructions')
      .select('*')
      .eq('assigned_buyer_id', user.id)
      .order('sale_close_at', { ascending: true, nullsFirst: false });
    if (error) { toast.error('Failed to load instructions'); return; }
    setInstructions((data as unknown as Instruction[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchInstructions();

    // Realtime subscription for live updates
    realtimeRef.current = supabase
      .channel('fleet-buyer-instructions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fleet_buyer_instructions' }, () => {
        fetchInstructions();
      })
      .subscribe();

    return () => { realtimeRef.current?.unsubscribe(); };
  }, [fetchInstructions]);

  const handleAction = async (id: string, action: string, data?: Record<string, unknown>) => {
    const updates: Record<string, unknown> = { status: action, updated_at: new Date().toISOString() };
    if (action === 'acknowledged') updates.acknowledged_at = new Date().toISOString();
    if (action === 'bid_placed') { updates.bid_amount = data?.bid_amount; updates.bid_placed_at = new Date().toISOString(); }
    if (['won', 'lost', 'passed'].includes(action)) updates.outcome_at = new Date().toISOString();

    const { error } = await supabase.from('fleet_buyer_instructions').update(updates).eq('id', id);
    if (error) { toast.error('Failed to update instruction'); return; }

    // Log activity
    await (supabase.from('fleet_buyer_activity') as any).insert({
      instruction_id: id,
      user_id: user?.id,
      action,
      action_data: data || null,
    });

    toast.success(action === 'won' ? 'Marked as WON' : action === 'lost' ? 'Marked as LOST' : action === 'bid_placed' ? 'Bid logged' : 'Updated');
    fetchInstructions();
  };

  const active = instructions.filter((i) => ['pending', 'acknowledged'].includes(i.status));
  const bidPlaced = instructions.filter((i) => i.status === 'bid_placed');
  const completed = instructions.filter((i) => ['won', 'lost', 'passed', 'expired'].includes(i.status));

  const critical = active.filter((i) => i.priority === 'critical').length;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <Target className="h-5 w-5 text-emerald-400" />
              Buyer Terminal
            </h1>
            <p className="text-white/40 text-sm mt-0.5">Your buying instructions — act fast on critical items</p>
          </div>
          <div className="flex items-center gap-3">
            {critical > 0 && (
              <span className="flex items-center gap-1.5 text-red-400 text-sm font-semibold animate-pulse">
                <Zap className="h-4 w-4" /> {critical} CRITICAL
              </span>
            )}
            <Button size="sm" variant="ghost" className="text-white/40 hover:text-white" onClick={fetchInstructions}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 border-b border-white/10">
        {[
          { label: 'Active', value: active.length, icon: Target, color: 'text-white' },
          { label: 'Critical', value: critical, icon: AlertTriangle, color: 'text-red-400' },
          { label: 'Bids Placed', value: bidPlaced.length, icon: DollarSign, color: 'text-amber-400' },
          { label: 'Won Today', value: completed.filter((i) => i.status === 'won').length, icon: CheckCircle2, color: 'text-emerald-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="px-6 py-3 border-r border-white/10 last:border-r-0">
            <div className="flex items-center gap-2">
              <Icon className={cn('h-4 w-4', color)} />
              <span className="text-white/50 text-xs uppercase tracking-wider">{label}</span>
            </div>
            <p className={cn('text-2xl font-bold mt-0.5', color)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="px-6 py-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="bg-white/5 border border-white/10">
            <TabsTrigger value="active" className="data-[state=active]:bg-white/10">
              Active {active.length > 0 && <span className="ml-1.5 text-xs bg-white/20 px-1.5 py-0.5 rounded-full">{active.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="bid_placed" className="data-[state=active]:bg-white/10">
              Bids Placed {bidPlaced.length > 0 && <span className="ml-1.5 text-xs bg-amber-500/30 text-amber-400 px-1.5 py-0.5 rounded-full">{bidPlaced.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="completed" className="data-[state=active]:bg-white/10">
              Completed
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-4 space-y-3">
            {loading ? (
              <div className="text-center py-12 text-white/30">Loading instructions…</div>
            ) : active.length === 0 ? (
              <div className="text-center py-12">
                <Shield className="h-10 w-10 text-white/20 mx-auto mb-3" />
                <p className="text-white/40">No active instructions right now.</p>
                <p className="text-white/20 text-sm mt-1">New instructions appear here automatically as opportunities are identified.</p>
              </div>
            ) : (
              // Sort: critical first, then by close time
              [...active]
                .sort((a, b) => {
                  const pOrder = { critical: 0, high: 1, normal: 2 };
                  if (pOrder[a.priority] !== pOrder[b.priority]) return pOrder[a.priority] - pOrder[b.priority];
                  if (!a.sale_close_at) return 1;
                  if (!b.sale_close_at) return -1;
                  return new Date(a.sale_close_at).getTime() - new Date(b.sale_close_at).getTime();
                })
                .map((i) => <InstructionCard key={i.id} instruction={i} onAction={handleAction} />)
            )}
          </TabsContent>

          <TabsContent value="bid_placed" className="mt-4 space-y-3">
            {bidPlaced.length === 0 ? (
              <div className="text-center py-12 text-white/30">No bids placed yet today.</div>
            ) : (
              bidPlaced.map((i) => <InstructionCard key={i.id} instruction={i} onAction={handleAction} />)
            )}
          </TabsContent>

          <TabsContent value="completed" className="mt-4 space-y-3">
            {completed.length === 0 ? (
              <div className="text-center py-12 text-white/30">No completed instructions.</div>
            ) : (
              completed.map((i) => <InstructionCard key={i.id} instruction={i} onAction={handleAction} />)
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
