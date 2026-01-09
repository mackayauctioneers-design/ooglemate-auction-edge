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
import { format } from 'date-fns';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

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

const getTrapName = (source: string) => {
  // Extract dealer name from source (e.g., "trap_dealer_xyz" -> "dealer_xyz")
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
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="w-[180px]">Trap (Dealer)</TableHead>
            <TableHead>Vehicle</TableHead>
            <TableHead className="text-right w-[100px]">KM</TableHead>
            <TableHead className="text-right w-[120px]">Price</TableHead>
            <TableHead className="text-center w-[100px]">First Seen</TableHead>
            <TableHead className="text-center w-[80px]">Days</TableHead>
            <TableHead className="text-right w-[140px]">Price Change</TableHead>
            <TableHead className="text-center w-[100px]">Status</TableHead>
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
                <div className="truncate max-w-[180px]" title={getTrapName(listing.source)}>
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
              <TableCell className="text-center text-sm text-muted-foreground">
                {format(new Date(listing.first_seen_at), 'dd MMM')}
              </TableCell>
              <TableCell className="text-center font-medium">
                {listing.days_on_market}
              </TableCell>
              <TableCell className="text-right">
                <PriceChangeCell 
                  amount={listing.price_change_amount} 
                  pct={listing.price_change_pct}
                  lastChangeDate={listing.last_price_change_date}
                />
              </TableCell>
              <TableCell className="text-center">
                {getStatusBadge(listing.days_on_market)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PriceChangeCell({ 
  amount, 
  pct, 
  lastChangeDate 
}: { 
  amount: number | null; 
  pct: number | null;
  lastChangeDate: string | null;
}) {
  if (amount === null || amount === 0) {
    return (
      <div className="flex items-center justify-end gap-1 text-muted-foreground">
        <Minus className="h-3 w-3" />
        <span className="text-sm">No change</span>
      </div>
    );
  }

  const isNegative = amount < 0;
  const Icon = isNegative ? TrendingDown : TrendingUp;
  const colorClass = isNegative ? 'text-emerald-600' : 'text-destructive';

  return (
    <div className={cn('flex flex-col items-end', colorClass)}>
      <div className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        <span className="font-medium mono text-sm">
          {formatCurrency(Math.abs(amount))}
        </span>
        <span className="text-xs">
          ({Math.abs(pct ?? 0).toFixed(1)}%)
        </span>
      </div>
      {lastChangeDate && (
        <span className="text-xs text-muted-foreground">
          {format(new Date(lastChangeDate), 'dd MMM')}
        </span>
      )}
    </div>
  );
}
