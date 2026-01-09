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
import { TrendingDown, TrendingUp, Minus, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface TrapInventoryTableProps {
  listings: TrapListing[];
  onRowClick: (listing: TrapListing) => void;
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

const getDealLabelBadge = (dealLabel: string) => {
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

export function TrapInventoryTable({ listings, onRowClick }: TrapInventoryTableProps) {
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
            {listings.map(listing => (
              <TableRow
                key={listing.id}
                onClick={() => onRowClick(listing)}
                className="cursor-pointer hover:bg-muted/30"
              >
                <TableCell className="font-medium">
                  <div className="truncate max-w-[160px]" title={getTrapName(listing.source)}>
                    {getTrapName(listing.source)}
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    <span className="font-medium">{listing.year} {listing.make} {listing.model}</span>
                    {listing.variant_family && (
                      <span className="text-muted-foreground text-sm ml-1">
                        ({listing.variant_family})
                      </span>
                    )}
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
                  {getDealLabelBadge(listing.deal_label)}
                </TableCell>
              </TableRow>
            ))}
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
