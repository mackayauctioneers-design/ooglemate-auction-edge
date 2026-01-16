import { ExternalLink, TrendingDown, Target, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HuntOpportunity } from '@/hooks/useHomeDashboard';
import { useNavigate } from 'react-router-dom';

interface HuntOpportunityCardProps {
  opportunity: HuntOpportunity;
}

export function HuntOpportunityCard({ opportunity }: HuntOpportunityCardProps) {
  const navigate = useNavigate();
  
  const isBuy = opportunity.severity === 'BUY';
  const gapPct = opportunity.gap_pct || 0;
  const gapDollars = opportunity.gap_dollars || 0;

  const formatCurrency = (value: number | null) => 
    value != null ? `$${value.toLocaleString()}` : '—';

  return (
    <Card className={`relative overflow-hidden ${isBuy ? 'border-green-500/50 bg-green-500/5' : 'border-yellow-500/30 bg-yellow-500/5'}`}>
      {/* Severity badge */}
      <div className="absolute top-2 right-2">
        <Badge 
          variant={isBuy ? 'default' : 'secondary'}
          className={isBuy ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700 text-white'}
        >
          {isBuy ? 'BUY' : 'WATCH'}
        </Badge>
      </div>

      <CardContent className="pt-4 pb-3">
        {/* Vehicle identity */}
        <div className="flex items-start gap-2 mb-3">
          <Target className={`h-4 w-4 mt-0.5 ${isBuy ? 'text-green-600' : 'text-yellow-600'}`} />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">
              {opportunity.year} {opportunity.make} {opportunity.model}
            </h3>
            <p className="text-xs text-muted-foreground">
              {opportunity.km?.toLocaleString() || '—'} km • via {opportunity.source || 'unknown'}
            </p>
          </div>
        </div>

        {/* Pricing */}
        <div className="grid grid-cols-3 gap-2 mb-3 text-center">
          <div className="bg-muted/30 rounded p-2">
            <p className="text-xs text-muted-foreground">Asking</p>
            <p className="font-semibold text-sm mono">{formatCurrency(opportunity.asking_price)}</p>
          </div>
          <div className="bg-muted/30 rounded p-2">
            <p className="text-xs text-muted-foreground">Proven Exit</p>
            <p className="font-semibold text-sm mono">{formatCurrency(opportunity.proven_exit_value)}</p>
          </div>
          <div className={`rounded p-2 ${isBuy ? 'bg-green-500/20' : 'bg-yellow-500/20'}`}>
            <p className="text-xs text-muted-foreground">Gap</p>
            <p className={`font-bold text-sm mono ${isBuy ? 'text-green-600' : 'text-yellow-600'}`}>
              {gapPct > 0 ? `+${gapPct.toFixed(1)}%` : `${gapPct.toFixed(1)}%`}
            </p>
          </div>
        </div>

        {/* Gap highlight */}
        {gapDollars > 0 && (
          <div className={`flex items-center gap-1 text-xs mb-3 ${isBuy ? 'text-green-600' : 'text-yellow-600'}`}>
            <TrendingDown className="h-3 w-3" />
            <span className="font-medium">
              {formatCurrency(gapDollars)} below proven exit
            </span>
          </div>
        )}

        {/* Confidence */}
        <div className="flex items-center gap-2 mb-3">
          {opportunity.confidence === 'high' ? (
            <Badge variant="outline" className="text-[10px] border-green-500/50 text-green-600">
              <ShieldCheck className="h-3 w-3 mr-1" />
              High Confidence
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {opportunity.confidence || 'Medium'} Confidence
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px]">
            {opportunity.type}
          </Badge>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button 
            size="sm" 
            variant="outline" 
            className="flex-1 text-xs h-8"
            onClick={() => navigate(`/hunts/${opportunity.hunt_id}`)}
          >
            View Hunt
          </Button>
          {opportunity.url && (
            <Button 
              size="sm" 
              variant="ghost" 
              className="text-xs h-8 px-2"
              onClick={() => window.open(opportunity.url!, '_blank')}
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
