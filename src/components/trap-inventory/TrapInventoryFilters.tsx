import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RotateCcw, TrendingDown, Clock, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TrapInventoryFiltersState {
  dealer: string;
  make: string;
  model: string;
  daysOnMarket: string;
  deltaBand: string;
  preset: 'none' | 'strong_buy' | 'mispriced' | '90_plus';
  sortBy: 'delta_pct' | 'days_on_market' | 'price_drop' | 'price';
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

const deltaBandOptions = [
  { value: 'all', label: 'All' },
  { value: 'under_15', label: '≤-15% (Strong Buy)' },
  { value: 'under_10', label: '≤-10%' },
  { value: 'under_5', label: '≤-5%' },
  { value: 'at_benchmark', label: 'At Benchmark (±5%)' },
  { value: 'over_5', label: '≥+5% (Overpriced)' },
  { value: 'no_benchmark', label: 'No Benchmark' },
];

const sortOptions = [
  { value: 'delta_pct', label: 'Under % (Delta)' },
  { value: 'days_on_market', label: 'Days on Market' },
  { value: 'price_drop', label: 'Price Drop' },
  { value: 'price', label: 'Current Price' },
];

const presets = [
  { value: 'strong_buy', label: 'Strong Buy', icon: Zap, color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
  { value: 'mispriced', label: 'Mispriced', icon: TrendingDown, color: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
  { value: '90_plus', label: '90+ Days', icon: Clock, color: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
] as const;

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

  const togglePreset = (preset: TrapInventoryFiltersState['preset']) => {
    if (filters.preset === preset) {
      updateFilter('preset', 'none');
    } else {
      onFiltersChange({ 
        ...filters, 
        preset,
        // Reset conflicting filters when preset is active
        daysOnMarket: preset === '90_plus' ? '90-999' : 'all',
        deltaBand: preset === 'strong_buy' ? 'under_15' : preset === 'mispriced' ? 'all' : 'all',
      });
    }
  };

  const resetFilters = () => {
    onFiltersChange({
      dealer: '',
      make: '',
      model: '',
      daysOnMarket: 'all',
      deltaBand: 'all',
      preset: 'none',
      sortBy: 'delta_pct',
      sortDir: 'asc',
    });
  };

  const hasActiveFilters = filters.dealer || filters.make || filters.model || 
    filters.daysOnMarket !== 'all' || filters.deltaBand !== 'all' || filters.preset !== 'none';

  return (
    <div className="space-y-3">
      {/* Presets Row */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground mr-1">Quick filters:</span>
        {presets.map(({ value, label, icon: Icon, color }) => (
          <Badge
            key={value}
            variant="outline"
            className={cn(
              'cursor-pointer transition-all hover:scale-105',
              filters.preset === value ? color : 'opacity-60 hover:opacity-100'
            )}
            onClick={() => togglePreset(value)}
          >
            <Icon className="h-3 w-3 mr-1" />
            {label}
          </Badge>
        ))}
      </div>

      {/* Main Filters Row */}
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

        {/* Delta Band Filter */}
        <Select value={filters.deltaBand} onValueChange={v => updateFilter('deltaBand', v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Delta %" />
          </SelectTrigger>
          <SelectContent>
            {deltaBandOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
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
          {filters.sortDir === 'asc' ? '↑ Low–High' : '↓ High–Low'}
        </Button>

        {/* Reset */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="ml-auto">
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}
