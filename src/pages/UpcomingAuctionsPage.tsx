import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO, addDays, isAfter, isBefore, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { ExternalLink, Plus, Pencil, Loader2 } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { dataService } from '@/services/dataService';
import { useAuth } from '@/contexts/AuthContext';
import { AuctionEvent } from '@/types';
import { AuctionEventEditor } from '@/components/auctions/AuctionEventEditor';

const AEST_TIMEZONE = 'Australia/Sydney';

type DateRangeFilter = 'next7' | 'next14' | 'all';

export default function UpcomingAuctionsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  
  const [auctionHouseFilter, setAuctionHouseFilter] = useState<string>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>('next7');
  const [editingEvent, setEditingEvent] = useState<AuctionEvent | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['auctionEvents'],
    queryFn: () => dataService.getAuctionEvents(),
  });

  const { data: filterOptions } = useQuery({
    queryKey: ['eventFilterOptions'],
    queryFn: () => dataService.getEventFilterOptions(),
  });

  // Filter and sort events
  const filteredEvents = useMemo(() => {
    const now = startOfDay(new Date());
    
    return events
      .filter((event) => {
        // Only active events
        if (event.active !== 'Y') return false;
        
        // Parse the datetime
        const eventDate = parseISO(event.start_datetime);
        
        // Date range filter
        if (dateRangeFilter === 'next7') {
          const cutoff = addDays(now, 7);
          if (isAfter(eventDate, cutoff) || isBefore(eventDate, now)) return false;
        } else if (dateRangeFilter === 'next14') {
          const cutoff = addDays(now, 14);
          if (isAfter(eventDate, cutoff) || isBefore(eventDate, now)) return false;
        } else {
          // 'all' - only show future events
          if (isBefore(eventDate, now)) return false;
        }
        
        // Auction house filter
        if (auctionHouseFilter !== 'all' && event.auction_house !== auctionHouseFilter) return false;
        
        // Location filter
        if (locationFilter !== 'all' && event.location !== locationFilter) return false;
        
        return true;
      })
      .sort((a, b) => {
        const dateA = parseISO(a.start_datetime);
        const dateB = parseISO(b.start_datetime);
        return dateA.getTime() - dateB.getTime();
      });
  }, [events, auctionHouseFilter, locationFilter, dateRangeFilter]);

  // Group events by date (AEST)
  const groupedEvents = useMemo(() => {
    const groups: Record<string, AuctionEvent[]> = {};
    
    filteredEvents.forEach((event) => {
      const eventDate = parseISO(event.start_datetime);
      const aestDate = toZonedTime(eventDate, AEST_TIMEZONE);
      const dateKey = format(aestDate, 'yyyy-MM-dd');
      
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(event);
    });
    
    return groups;
  }, [filteredEvents]);

  const handleEventSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['auctionEvents'] });
    queryClient.invalidateQueries({ queryKey: ['eventFilterOptions'] });
    setEditingEvent(null);
    setIsCreating(false);
  };

  const formatEventTime = (datetime: string) => {
    const date = parseISO(datetime);
    const aestDate = toZonedTime(date, AEST_TIMEZONE);
    return format(aestDate, 'h:mm a');
  };

  const formatDateHeader = (dateKey: string) => {
    const date = parseISO(dateKey);
    return format(date, 'EEEE, d MMMM yyyy');
  };

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Upcoming Auctions</h1>
            <p className="text-muted-foreground">Scheduled auction events</p>
          </div>
          {isAdmin && (
            <Button onClick={() => setIsCreating(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Event
            </Button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <Select value={auctionHouseFilter} onValueChange={setAuctionHouseFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Auction House" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Auction Houses</SelectItem>
              {filterOptions?.auction_houses.map((house) => (
                <SelectItem key={house} value={house}>{house}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={locationFilter} onValueChange={setLocationFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {filterOptions?.locations.map((loc) => (
                <SelectItem key={loc} value={loc}>{loc}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={dateRangeFilter} onValueChange={(v) => setDateRangeFilter(v as DateRangeFilter)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Date Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="next7">Next 7 Days</SelectItem>
              <SelectItem value="next14">Next 14 Days</SelectItem>
              <SelectItem value="all">All Upcoming</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Events List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : Object.keys(groupedEvents).length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No upcoming auctions found for the selected filters.
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedEvents).map(([dateKey, dayEvents]) => (
              <div key={dateKey} className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground border-b border-border pb-2">
                  {formatDateHeader(dateKey)}
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {dayEvents.map((event) => (
                    <Card key={event.event_id} className="relative group">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold text-foreground line-clamp-2">
                            {event.event_title}
                          </h3>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="iconSm"
                              onClick={() => setEditingEvent(event)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        
                        <div className="space-y-1 text-sm">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{event.auction_house}</Badge>
                          </div>
                          <p className="text-muted-foreground">{event.location}</p>
                          <p className="text-muted-foreground font-medium">
                            {formatEventTime(event.start_datetime)} AEST
                          </p>
                        </div>
                        
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-2"
                          onClick={() => window.open(event.event_url, '_blank')}
                        >
                          <ExternalLink className="h-4 w-4" />
                          Open
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Event Editor Modal */}
        {(editingEvent || isCreating) && (
          <AuctionEventEditor
            event={editingEvent}
            onClose={() => {
              setEditingEvent(null);
              setIsCreating(false);
            }}
            onSaved={handleEventSaved}
          />
        )}
      </div>
    </AppLayout>
  );
}
