import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';

export interface TrapInventoryFiltersState {
  dealer: string;
  make: string;
  model: string;
  daysOnMarket: string;
  sortBy: 'days_on_market' | 'price_drop' | 'price';
  sortDir: 'asc' | 'desc';
}

interface TrapInventoryFiltersProps {
  filters: TrapInventoryFiltersState;
  onFiltersChange: (filters: TrapInventoryFiltersState) => void;
  dealers: string[];
  makes: string[];
  models: string[];
}

const daysOnMarketOptions = [
  { value: 'all', label: 'All' },
  { value: '0-14', label: '0–14 days (Fresh)' },
  { value: '15-30', label: '15–30 days' },
  { value: '31-60', label: '31–60 days (Sticky)' },
  { value: '61-90', label: '61–90 days (Softening)' },
  { value: '90-999', label: '90+ days' },
];

const sortOptions = [
  { value: 'days_on_market', label: 'Days on Market' },
  { value: 'price_drop', label: 'Price Drop' },
  { value: 'price', label: 'Current Price' },
];

export function TrapInventoryFilters({ 
  filters, 
  onFiltersChange, 
  dealers, 
  makes, 
  models 
}: TrapInventoryFiltersProps) {
  const updateFilter = <K extends keyof TrapInventoryFiltersState>(
    key: K, 
    value: TrapInventoryFiltersState[K]
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const resetFilters = () => {
    onFiltersChange({
      dealer: '',
      make: '',
      model: '',
      daysOnMarket: 'all',
      sortBy: 'days_on_market',
      sortDir: 'desc',
    });
  };

  const hasActiveFilters = filters.dealer || filters.make || filters.model || filters.daysOnMarket !== 'all';

  return (
    <div className="flex flex-wrap items-center gap-3 p-4 bg-muted/30 rounded-lg border border-border">
      {/* Dealer Filter */}
      <Select value={filters.dealer || 'all'} onValueChange={v => updateFilter('dealer', v === 'all' ? '' : v)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All Dealers" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Dealers</SelectItem>
          {dealers.map(d => (
            <SelectItem key={d} value={d}>{d}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Make Filter */}
      <Select value={filters.make || 'all'} onValueChange={v => updateFilter('make', v === 'all' ? '' : v)}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="All Makes" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Makes</SelectItem>
          {makes.map(m => (
            <SelectItem key={m} value={m}>{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Model Filter */}
      <Select value={filters.model || 'all'} onValueChange={v => updateFilter('model', v === 'all' ? '' : v)}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="All Models" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Models</SelectItem>
          {models.map(m => (
            <SelectItem key={m} value={m}>{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Days on Market Filter */}
      <Select value={filters.daysOnMarket} onValueChange={v => updateFilter('daysOnMarket', v)}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Days on Market" />
        </SelectTrigger>
        <SelectContent>
          {daysOnMarketOptions.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="h-6 w-px bg-border mx-1" />

      {/* Sort By */}
      <Select 
        value={filters.sortBy} 
        onValueChange={v => updateFilter('sortBy', v as TrapInventoryFiltersState['sortBy'])}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Sort Direction */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => updateFilter('sortDir', filters.sortDir === 'desc' ? 'asc' : 'desc')}
        className="px-3"
      >
        {filters.sortDir === 'desc' ? '↓ High–Low' : '↑ Low–High'}
      </Button>

      {/* Reset */}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={resetFilters} className="ml-auto">
          <RotateCcw className="h-4 w-4 mr-1" />
          Reset
        </Button>
      )}
    </div>
  );
}
