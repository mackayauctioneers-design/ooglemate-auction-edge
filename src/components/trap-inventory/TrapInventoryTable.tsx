import { TrapListing } from '@/pages/TrapInventoryPage';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TrendingDown, TrendingUp, Minus, HelpCircle, Eye, Pin, StickyNote, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface TrapInventoryTableProps {
  listings: TrapListing[];
  onRowClick: (listing: TrapListing) => void;
  watchedIds?: Set<string>;
  pinnedIds?: Set<string>;
  notesIds?: Set<string>;
}

const formatCurrency = (val: number | null) => {
  if (val === null) return '-';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(val);
};

const formatNumber = (val: number | null) => {
  if (val === null) return '-';
  return new Intl.NumberFormat('en-AU').format(val);
};

const getStatusBadge = (days: number) => {
  if (days <= 14) {
    return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Fresh</Badge>;
  } else if (days <= 60) {
    return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">Sticky</Badge>;
  } else if (days <= 90) {
    return <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/30">Softening</Badge>;
  } else {
    return <Badge variant="destructive">90+ days</Badge>;
  }
};

const getDealLabelBadge = (dealLabel: string, soldReturnedSuspected?: boolean) => {
  // If return risk, show that badge instead
  if (soldReturnedSuspected) {
    return (
      <Badge variant="destructive" className="bg-red-600 hover:bg-red-600">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Return Risk
      </Badge>
    );
  }

  switch (dealLabel) {
    case 'MISPRICED':
      return <Badge className="bg-emerald-600 hover:bg-emerald-600">Mispriced</Badge>;
    case 'STRONG_BUY':
      return <Badge className="bg-emerald-500 hover:bg-emerald-500">Strong Buy</Badge>;
    case 'WATCH':
      return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Watch</Badge>;
    case 'NORMAL':
      return <Badge variant="outline">Normal</Badge>;
    case 'NO_BENCHMARK':
    default:
      return (
        <Badge variant="outline" className="opacity-50">
          <HelpCircle className="h-3 w-3 mr-1" />
          No data
        </Badge>
      );
  }
};

const getTrapName = (source: string) => {
  return source.replace(/^trap_/, '').replace(/_/g, ' ');
};

export function TrapInventoryTable({ listings, onRowClick, watchedIds, pinnedIds, notesIds }: TrapInventoryTableProps) {
  if (listings.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p>No listings found matching your filters.</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-[160px]">Trap (Dealer)</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead className="text-right w-[90px]">KM</TableHead>
              <TableHead className="text-right w-[100px]">Price</TableHead>
              <TableHead className="text-right w-[100px]">Benchmark</TableHead>
              <TableHead className="text-center w-[110px]">Δ%</TableHead>
              <TableHead className="text-center w-[70px]">Days</TableHead>
              <TableHead className="text-center w-[100px]">Deal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
          {listings.map(listing => {
              const isWatched = watchedIds?.has(listing.id) ?? false;
              const isPinned = pinnedIds?.has(listing.id) ?? false;
              const hasNotes = notesIds?.has(listing.id) ?? false;
              
              return (
              <TableRow
                key={listing.id}
                onClick={() => onRowClick(listing)}
                className={cn(
                  "cursor-pointer hover:bg-muted/30",
                  isPinned && "bg-primary/5 border-l-2 border-l-primary"
                )}
              >
                <TableCell className="font-medium">
                  <div className="truncate max-w-[160px]" title={getTrapName(listing.source)}>
                    {getTrapName(listing.source)}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 min-w-[40px]">
                      {isPinned && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Pin className="h-3 w-3 text-primary" />
                          </TooltipTrigger>
                          <TooltipContent>Pinned</TooltipContent>
                        </Tooltip>
                      )}
                      {isWatched && !isPinned && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Eye className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>Watching</TooltipContent>
                        </Tooltip>
                      )}
                      {hasNotes && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <StickyNote className="h-3 w-3 text-amber-500" />
                          </TooltipTrigger>
                          <TooltipContent>Has notes</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <div>
                      <span className="font-medium">{listing.year} {listing.make} {listing.model}</span>
                      {listing.variant_family && (
                        <span className="text-muted-foreground text-sm ml-1">
                          ({listing.variant_family})
                        </span>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right mono text-sm">
                  {listing.km ? `${formatNumber(listing.km)} km` : '-'}
                </TableCell>
                <TableCell className="text-right font-semibold mono">
                  {formatCurrency(listing.asking_price)}
                </TableCell>
                <TableCell className="text-right mono text-sm text-muted-foreground">
                  {listing.no_benchmark ? (
                    <span className="opacity-50">—</span>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help">{formatCurrency(listing.benchmark_price)}</span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Based on {listing.benchmark_sample} cleared sales
                      </TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  <DeltaCell 
                    deltaPct={listing.delta_pct} 
                    deltaDollars={listing.delta_dollars}
                    noBenchmark={listing.no_benchmark}
                  />
                </TableCell>
                <TableCell className="text-center font-medium">
                  {listing.days_on_market}
                </TableCell>
                <TableCell className="text-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>{getDealLabelBadge(listing.deal_label, listing.sold_returned_suspected)}</span>
                    </TooltipTrigger>
                    {listing.sold_returned_suspected && listing.sold_returned_reason && (
                      <TooltipContent className="max-w-[300px]">
                        <p className="font-semibold text-red-500">⚠️ Sold-Then-Returned Suspect</p>
                        <p className="text-xs mt-1">{listing.sold_returned_reason}</p>
                        <p className="text-xs mt-1 text-muted-foreground">Bob will not recommend buying this vehicle.</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}

function DeltaCell({ 
  deltaPct, 
  deltaDollars,
  noBenchmark 
}: { 
  deltaPct: number | null; 
  deltaDollars: number | null;
  noBenchmark: boolean;
}) {
  if (noBenchmark || deltaPct === null) {
    return (
      <div className="flex items-center justify-center text-muted-foreground opacity-50">
        <Minus className="h-3 w-3" />
      </div>
    );
  }

  const isUnder = deltaPct < 0;
  const Icon = isUnder ? TrendingDown : TrendingUp;
  const colorClass = isUnder ? 'text-emerald-600' : 'text-red-500';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn('flex flex-col items-center cursor-help', colorClass)}>
          <div className="flex items-center gap-1">
            <Icon className="h-3 w-3" />
            <span className="font-semibold mono text-sm">
              {deltaPct > 0 ? '+' : ''}{deltaPct.toFixed(1)}%
            </span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {isUnder ? 'Under' : 'Over'} benchmark by {formatCurrency(Math.abs(deltaDollars ?? 0))}
      </TooltipContent>
    </Tooltip>
  );
}
