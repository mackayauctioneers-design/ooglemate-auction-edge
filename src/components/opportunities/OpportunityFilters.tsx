import { useState } from 'react';
import { OpportunityFilters } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Filter, X, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface OpportunityFiltersProps {
  filters: OpportunityFilters;
  onFiltersChange: (filters: OpportunityFilters) => void;
  filterOptions: {
    auction_houses: string[];
    locations: string[];
  };
  onRefresh: () => void;
  isLoading: boolean;
}

export function OpportunityFiltersPanel({
  filters,
  onFiltersChange,
  filterOptions,
  onRefresh,
  isLoading,
}: OpportunityFiltersProps) {
  const { isAdmin } = useAuth();
  const [expanded, setExpanded] = useState(false);

  const updateFilter = <K extends keyof OpportunityFilters>(
    key: K,
    value: OpportunityFilters[K]
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onFiltersChange({
      auction_house: null,
      action: null,
      pass_count_min: null,
      location: null,
      margin_min: null,
      margin_max: null,
      show_all: false,
    });
  };

  const hasActiveFilters = 
    filters.auction_house || 
    filters.action || 
    filters.pass_count_min || 
    filters.location ||
    filters.margin_min ||
    filters.margin_max;

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded-full">
                {[filters.auction_house, filters.action, filters.pass_count_min, filters.location].filter(Boolean).length}
              </span>
            )}
          </Button>
          
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
              <X className="h-3 w-3" />
              Clear
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Switch
                id="show-all"
                checked={filters.show_all}
                onCheckedChange={(checked) => updateFilter('show_all', checked)}
              />
              <Label htmlFor="show-all" className="text-sm text-muted-foreground cursor-pointer">
                Show all
              </Label>
            </div>
          )}
          
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 pt-4 border-t border-border animate-fade-in">
          {/* Auction House */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Auction House</Label>
            <Select
              value={filters.auction_house || 'all'}
              onValueChange={(v) => updateFilter('auction_house', v === 'all' ? null : v)}
            >
              <SelectTrigger className="bg-input">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {filterOptions.auction_houses.map(house => (
                  <SelectItem key={house} value={house}>{house}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Action */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Action</Label>
            <Select
              value={filters.action || 'all'}
              onValueChange={(v) => updateFilter('action', v === 'all' ? null : v as 'Watch' | 'Buy')}
            >
              <SelectTrigger className="bg-input">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="Buy">Buy</SelectItem>
                <SelectItem value="Watch">Watch</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Pass Count */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Pass Count</Label>
            <Select
              value={filters.pass_count_min?.toString() || 'all'}
              onValueChange={(v) => updateFilter('pass_count_min', v === 'all' ? null : parseInt(v))}
            >
              <SelectTrigger className="bg-input">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any</SelectItem>
                <SelectItem value="2">≥2 passes</SelectItem>
                <SelectItem value="3">≥3 passes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Location</Label>
            <Select
              value={filters.location || 'all'}
              onValueChange={(v) => updateFilter('location', v === 'all' ? null : v)}
            >
              <SelectTrigger className="bg-input">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {filterOptions.locations.map(loc => (
                  <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Margin Min */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Min Margin</Label>
            <Input
              type="number"
              placeholder="$1,000"
              value={filters.margin_min || ''}
              onChange={(e) => updateFilter('margin_min', e.target.value ? parseInt(e.target.value) : null)}
              className="bg-input"
            />
          </div>

          {/* Margin Max */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Max Margin</Label>
            <Input
              type="number"
              placeholder="No limit"
              value={filters.margin_max || ''}
              onChange={(e) => updateFilter('margin_max', e.target.value ? parseInt(e.target.value) : null)}
              className="bg-input"
            />
          </div>
        </div>
      )}
    </div>
  );
}
