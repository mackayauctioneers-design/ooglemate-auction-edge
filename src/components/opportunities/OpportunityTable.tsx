import { useState } from 'react';
import { AuctionLot, formatCurrency, formatNumber } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';
import { OpportunityDrawer } from './OpportunityDrawer';
import { format } from 'date-fns';

interface OpportunityTableProps {
  opportunities: AuctionLot[];
  isLoading: boolean;
}

type SortField = 'action' | 'estimated_margin' | 'pass_count' | 'confidence_score' | 'year' | 'km' | 'auction_datetime';
type SortDirection = 'asc' | 'desc';

export function OpportunityTable({ opportunities, isLoading }: OpportunityTableProps) {
  const [selectedOpportunity, setSelectedOpportunity] = useState<AuctionLot | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sortField, setSortField] = useState<SortField>('action');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleRowClick = (lot: AuctionLot) => {
    setSelectedOpportunity(lot);
    setDrawerOpen(true);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedOpportunities = [...opportunities].sort((a, b) => {
    let aVal: number | string;
    let bVal: number | string;

    switch (sortField) {
      case 'action':
        aVal = a.action === 'Buy' ? 1 : 0;
        bVal = b.action === 'Buy' ? 1 : 0;
        break;
      case 'auction_datetime':
        aVal = new Date(a.auction_datetime).getTime() || 0;
        bVal = new Date(b.auction_datetime).getTime() || 0;
        break;
      default:
        aVal = a[sortField];
        bVal = b[sortField];
    }

    if (sortDirection === 'asc') {
      return aVal > bVal ? 1 : -1;
    }
    return aVal < bVal ? 1 : -1;
  });

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <ChevronUp className="h-3 w-3 inline ml-1" />
    ) : (
      <ChevronDown className="h-3 w-3 inline ml-1" />
    );
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 3) return 'text-primary';
    if (score >= 2) return 'text-action-watch';
    return 'text-destructive';
  };

  const formatAuctionDate = (dateStr: string) => {
    if (!dateStr) return '-';
    try {
      return format(new Date(dateStr), 'dd MMM HH:mm');
    } catch {
      return dateStr;
    }
  };

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="animate-pulse p-8 space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-muted rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (opportunities.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-12 text-center">
        <p className="text-muted-foreground">No opportunities match your filters</p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead 
                  className="table-header-cell cursor-pointer hover:text-foreground"
                  onClick={() => handleSort('action')}
                >
                  Action <SortIcon field="action" />
                </TableHead>
                <TableHead className="table-header-cell">Auction</TableHead>
                <TableHead 
                  className="table-header-cell cursor-pointer hover:text-foreground"
                  onClick={() => handleSort('auction_datetime')}
                >
                  Date <SortIcon field="auction_datetime" />
                </TableHead>
                <TableHead className="table-header-cell">Vehicle</TableHead>
                <TableHead 
                  className="table-header-cell cursor-pointer hover:text-foreground text-right"
                  onClick={() => handleSort('year')}
                >
                  Year <SortIcon field="year" />
                </TableHead>
                <TableHead 
                  className="table-header-cell cursor-pointer hover:text-foreground text-right"
                  onClick={() => handleSort('km')}
                >
                  KM <SortIcon field="km" />
                </TableHead>
                <TableHead 
                  className="table-header-cell cursor-pointer hover:text-foreground text-right"
                  onClick={() => handleSort('pass_count')}
                >
                  Passes <SortIcon field="pass_count" />
                </TableHead>
                <TableHead 
                  className="table-header-cell cursor-pointer hover:text-foreground text-right"
                  onClick={() => handleSort('estimated_margin')}
                >
                  Margin <SortIcon field="estimated_margin" />
                </TableHead>
                <TableHead 
                  className="table-header-cell cursor-pointer hover:text-foreground text-center"
                  onClick={() => handleSort('confidence_score')}
                >
                  Score <SortIcon field="confidence_score" />
                </TableHead>
                <TableHead className="table-header-cell text-right">Link</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedOpportunities.map((lot) => (
                <TableRow
                  key={lot.lot_key}
                  className="table-row-interactive border-b border-border"
                  onClick={() => handleRowClick(lot)}
                >
                  <TableCell>
                    <Badge variant={lot.action === 'Buy' ? 'buy' : 'watch'}>
                      {lot.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {lot.auction_house}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm mono">
                    {formatAuctionDate(lot.auction_datetime)}
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-foreground">{lot.make} {lot.model}</p>
                      <p className="text-xs text-muted-foreground">{lot.variant_normalised}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-right mono text-sm">{lot.year}</TableCell>
                  <TableCell className="text-right mono text-sm text-muted-foreground">
                    {formatNumber(lot.km)}
                  </TableCell>
                  <TableCell className="text-right">
                    {lot.pass_count > 0 && (
                      <Badge variant={lot.pass_count >= 3 ? 'passed' : 'outline'} className="text-xs">
                        {lot.pass_count}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="mono font-semibold text-primary">
                      {formatCurrency(lot.estimated_margin)}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`mono font-bold ${getConfidenceColor(lot.confidence_score)}`}>
                      {lot.confidence_score}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      asChild
                      onClick={(e) => e.stopPropagation()}
                    >
                      <a href={lot.listing_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                      </a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <OpportunityDrawer
        lot={selectedOpportunity}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}
