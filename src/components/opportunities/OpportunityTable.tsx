import { useState } from 'react';
import { AuctionOpportunity, formatCurrency, formatNumber } from '@/types';
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

interface OpportunityTableProps {
  opportunities: AuctionOpportunity[];
  isLoading: boolean;
}

type SortField = 'action' | 'estimated_margin' | 'pass_count' | 'confidence_score' | 'year' | 'km';
type SortDirection = 'asc' | 'desc';

export function OpportunityTable({ opportunities, isLoading }: OpportunityTableProps) {
  const [selectedOpportunity, setSelectedOpportunity] = useState<AuctionOpportunity | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sortField, setSortField] = useState<SortField>('estimated_margin');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleRowClick = (opp: AuctionOpportunity) => {
    setSelectedOpportunity(opp);
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
                <TableHead className="table-header-cell text-right">Reserve</TableHead>
                <TableHead className="table-header-cell text-right">Bid</TableHead>
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
              {sortedOpportunities.map((opp) => (
                <TableRow
                  key={opp.lot_id}
                  className="table-row-interactive border-b border-border"
                  onClick={() => handleRowClick(opp)}
                >
                  <TableCell>
                    <Badge variant={opp.action === 'Buy' ? 'buy' : 'watch'}>
                      {opp.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {opp.auction_house}
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-foreground">{opp.make} {opp.model}</p>
                      <p className="text-xs text-muted-foreground">{opp.variant_normalised}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-right mono text-sm">{opp.year}</TableCell>
                  <TableCell className="text-right mono text-sm text-muted-foreground">
                    {formatNumber(opp.km)}
                  </TableCell>
                  <TableCell className="text-right mono text-sm">
                    {formatCurrency(opp.reserve)}
                  </TableCell>
                  <TableCell className="text-right mono text-sm text-muted-foreground">
                    {formatCurrency(opp.highest_bid)}
                  </TableCell>
                  <TableCell className="text-right">
                    {opp.pass_count > 0 && (
                      <Badge variant={opp.pass_count >= 3 ? 'passed' : 'outline'} className="text-xs">
                        {opp.pass_count}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="mono font-semibold text-primary">
                      {formatCurrency(opp.estimated_margin)}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`mono font-bold ${getConfidenceColor(opp.confidence_score)}`}>
                      {opp.confidence_score}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      asChild
                      onClick={(e) => e.stopPropagation()}
                    >
                      <a href={opp.listing_url} target="_blank" rel="noopener noreferrer">
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
        opportunity={selectedOpportunity}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}
