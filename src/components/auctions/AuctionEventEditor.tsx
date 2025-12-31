import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { dataService } from '@/services/dataService';
import { AuctionEvent } from '@/types';
import { toast } from 'sonner';

interface AuctionEventEditorProps {
  event: AuctionEvent | null;
  onClose: () => void;
  onSaved: () => void;
}

export function AuctionEventEditor({ event, onClose, onSaved }: AuctionEventEditorProps) {
  const isEditing = !!event;
  
  const [formData, setFormData] = useState({
    event_title: event?.event_title || '',
    auction_house: event?.auction_house || '',
    location: event?.location || '',
    start_datetime: event?.start_datetime ? formatDatetimeLocal(event.start_datetime) : '',
    event_url: event?.event_url || '',
    active: event?.active || 'Y',
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const eventData = {
        ...formData,
        start_datetime: new Date(formData.start_datetime).toISOString(),
      };
      
      if (isEditing && event) {
        await dataService.updateAuctionEvent({
          ...event,
          ...eventData,
        });
      } else {
        await dataService.addAuctionEvent(eventData as Omit<AuctionEvent, 'event_id'>);
      }
    },
    onSuccess: () => {
      toast.success(isEditing ? 'Event updated' : 'Event created');
      onSaved();
    },
    onError: (error) => {
      toast.error(`Failed to save event: ${error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.event_title || !formData.auction_house || !formData.location || !formData.start_datetime) {
      toast.error('Please fill in all required fields');
      return;
    }
    
    saveMutation.mutate();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Event' : 'Create Event'}</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="event_title">Event Title *</Label>
            <Input
              id="event_title"
              value={formData.event_title}
              onChange={(e) => setFormData({ ...formData, event_title: e.target.value })}
              placeholder="e.g. Weekly Car Auction"
            />
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="auction_house">Auction House *</Label>
              <Input
                id="auction_house"
                value={formData.auction_house}
                onChange={(e) => setFormData({ ...formData, auction_house: e.target.value })}
                placeholder="e.g. Pickles"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="location">Location *</Label>
              <Input
                id="location"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="e.g. Sydney"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="start_datetime">Start Date & Time (AEST) *</Label>
            <Input
              id="start_datetime"
              type="datetime-local"
              value={formData.start_datetime}
              onChange={(e) => setFormData({ ...formData, start_datetime: e.target.value })}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="event_url">Event URL</Label>
            <Input
              id="event_url"
              type="url"
              value={formData.event_url}
              onChange={(e) => setFormData({ ...formData, event_url: e.target.value })}
              placeholder="https://..."
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="active">Status</Label>
            <Select value={formData.active} onValueChange={(v) => setFormData({ ...formData, active: v as 'Y' | 'N' })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Y">Active</SelectItem>
                <SelectItem value="N">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" disabled={saveMutation.isPending} className="w-full sm:w-auto">
              {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Create Event'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatDatetimeLocal(isoString: string): string {
  try {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch {
    return '';
  }
}
