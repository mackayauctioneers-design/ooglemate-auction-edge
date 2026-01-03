import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import { AuctionLot } from '@/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ValoButtonProps {
  lot: AuctionLot;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'iconSm';
  showLabel?: boolean;
}

export function ValoButton({ lot, variant = 'ghost', size = 'iconSm', showLabel = false }: ValoButtonProps) {
  const navigate = useNavigate();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click

    // Build prefill text from lot details
    const parts: string[] = [];
    if (lot.year) parts.push(String(lot.year));
    if (lot.make) parts.push(lot.make);
    if (lot.model) parts.push(lot.model);
    if (lot.variant_normalised) parts.push(lot.variant_normalised);
    if (lot.km) parts.push(`${lot.km.toLocaleString()} km`);
    if (lot.transmission) parts.push(lot.transmission);
    if (lot.drivetrain) parts.push(lot.drivetrain);

    const prefillText = parts.join(' ');
    const params = new URLSearchParams();
    params.set('prefill', prefillText);
    if (lot.listing_url) {
      params.set('link', lot.listing_url);
    }

    navigate(`/valo?${params.toString()}`);
  };

  if (showLabel) {
    return (
      <Button variant={variant} size={size} onClick={handleClick} className="gap-1.5">
        <Sparkles className="h-3.5 w-3.5" />
        VALO
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={variant} size={size} onClick={handleClick}>
          <Sparkles className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Run VALO valuation</p>
      </TooltipContent>
    </Tooltip>
  );
}
