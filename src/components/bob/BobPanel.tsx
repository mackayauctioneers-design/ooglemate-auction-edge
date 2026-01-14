import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { 
  MessageCircle, Send, Loader2, 
  TrendingUp, TrendingDown, Minus, Clock, 
  HelpCircle, ChevronRight, AlertTriangle, Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useBobSiteContext } from '@/contexts/BobSiteContext';
import { useBobTools } from '@/hooks/useBobTools';
import bobAvatarVideo from '@/assets/bob-avatar.mp4';

// ============================================================================
// BOB PANEL - Site-aware dealer assistant
// ============================================================================

interface ChatMessage {
  role: 'user' | 'bob';
  content: string;
  data?: any; // structured data from tools
  actions?: Array<{
    label: string;
    route?: string;
    action?: string;
  }>;
}

// Intent detection for routing to appropriate tools
function detectIntent(message: string): 'opportunities' | 'auctions' | 'watchlist' | 'explain' | 'today' | 'help' | 'general' {
  const text = message.toLowerCase();
  
  // Today/brief intent
  if (text.includes('today') || text.includes('brief') || text.includes('what should i do') || text.includes('morning')) {
    return 'today';
  }
  
  // Opportunities intent
  if (text.includes('opportunit') || text.includes('buy') || text.includes('deal') || text.includes('what to get')) {
    return 'opportunities';
  }
  
  // Auction intent
  if (text.includes('auction') || text.includes('upcoming') || text.includes('lane')) {
    return 'auctions';
  }
  
  // Watchlist intent
  if (text.includes('watchlist') || text.includes('watching') || text.includes('saved') || text.includes('my list')) {
    return 'watchlist';
  }
  
  // Explain intent (when viewing a specific lot)
  if (text.includes('why') || text.includes('explain') || text.includes('how come') || text.includes('reason')) {
    return 'explain';
  }
  
  // Help intent
  if (text.includes('help') || text.includes('how do') || text.includes('what is') || text.includes('what are')) {
    return 'help';
  }
  
  return 'general';
}

// Format opportunity for display
function formatOpportunity(item: any): string {
  const parts = [
    `**${item.year} ${item.make} ${item.model}${item.variant ? ` ${item.variant}` : ''}**`,
    item.km ? `${(item.km / 1000).toFixed(0)}k km` : '',
    `@ ${item.auction_house} ${item.location || ''}`,
    item.relevance_score ? `(Score: ${item.relevance_score.toFixed(1)})` : '',
  ].filter(Boolean);
  
  const reasons = item.edge_reasons?.length 
    ? `\n  → ${item.edge_reasons.join(', ')}`
    : '';
  
  const action = item.next_action 
    ? `\n  📌 ${item.next_action}`
    : '';
  
  return parts.join(' • ') + reasons + action;
}

// Format auction card for display
function formatAuctionCard(card: any): string {
  const heatEmoji = {
    'VERY_HOT': '🔥🔥',
    'HOT': '🔥',
    'WARM': '⚠️',
    'COLD': '❄️'
  }[card.heat_tier] || '';
  
  const warnings = card.warnings?.includes('LOCATION_UNKNOWN') ? ' ⚠️ Location unknown' : '';
  
  return `${heatEmoji} **${card.auction_house}** ${card.location_label || 'Unknown'}
  ${card.relevant_lots} relevant / ${card.eligible_lots} eligible / ${card.total_lots} total${warnings}`;
}

export function BobPanel() {
  const { isAdmin, dealerProfile, user } = useAuth();
  const { runtimeContext } = useBobSiteContext();
  const bobTools = useBobTools();
  const navigate = useNavigate();
  
  // Extract from runtime context
  const filters = runtimeContext?.filters;
  const selection = runtimeContext?.selection ?? { lot_id: null, auction_event_id: null };
  
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [accountNotLinked, setAccountNotLinked] = useState(false);

  const dealerName = dealerProfile?.dealer_name || 'mate';

  // Add initial greeting when panel opens
  useEffect(() => {
    if (isOpen && messages.length === 0 && user) {
      const contextSummary = bobTools.getContextSummary();
      setMessages([{
        role: 'bob',
        content: `G'day ${dealerName}. ${contextSummary}\n\nWhat do you need?`,
        actions: [
          { label: 'What opportunities today?', action: 'opportunities' },
          { label: 'Show upcoming auctions', action: 'auctions' },
          { label: 'My watchlist', action: 'watchlist' }
        ]
      }]);
    }
  }, [isOpen, messages.length, user, dealerName, bobTools]);

  // Handle user message with tool calls
  const handleSend = useCallback(async () => {
    if (!input.trim() || !user) return;

    const userMessage = input.trim();
    setInput('');
    
    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const intent = detectIntent(userMessage);
      let response: ChatMessage;

      switch (intent) {
        case 'today':
        case 'opportunities': {
          const opps = await bobTools.getTodayOpportunities();
          if (!opps) {
            response = { role: 'bob', content: 'Having trouble getting opportunities. Make sure you\'re logged in.' };
          } else if (!opps.items?.length) {
            response = { 
              role: 'bob', 
              content: `Nothing jumping out right now based on your filters. ${filters?.eligible_only ? 'You\'ve got "eligible only" on - maybe widen the net?' : 'Try adjusting your search criteria.'}`,
              actions: [{ label: 'View All Auctions', route: '/upcoming-auctions' }]
            };
          } else {
            const topItems = opps.items.slice(0, 5);
            const formatted = topItems.map((item: any, i: number) => `${i + 1}. ${formatOpportunity(item)}`).join('\n\n');
            response = {
              role: 'bob',
              content: `Found ${opps.counts?.total || opps.items.length} opportunities. Here's the top ones:\n\n${formatted}`,
              data: opps,
              actions: [{ label: 'View Opportunities', route: '/opportunities' }]
            };
          }
          break;
        }

        case 'auctions': {
          const auctions = await bobTools.getUpcomingAuctionCards();
          if (!auctions) {
            response = { role: 'bob', content: 'Couldn\'t fetch auctions. Make sure you\'re logged in.' };
          } else if (!auctions.cards?.length) {
            response = { 
              role: 'bob', 
              content: 'No auctions matching your current filters. Try widening the date range or location.',
              actions: [{ label: 'View All Auctions', route: '/upcoming-auctions' }]
            };
          } else {
            const hotAuctions = auctions.cards.filter((c: any) => c.heat_tier === 'VERY_HOT' || c.heat_tier === 'HOT');
            const formatted = auctions.cards.slice(0, 5).map((card: any) => formatAuctionCard(card)).join('\n\n');
            response = {
              role: 'bob',
              content: `${auctions.cards.length} auctions coming up. ${hotAuctions.length > 0 ? `${hotAuctions.length} looking hot.` : ''}\n\n${formatted}`,
              data: auctions,
              actions: [{ label: 'View Upcoming Auctions', route: '/upcoming-auctions' }]
            };
          }
          break;
        }

        case 'watchlist': {
          const watchlist = await bobTools.getWatchlist();
          if (!watchlist) {
            response = { role: 'bob', content: 'Couldn\'t get your watchlist. Make sure you\'re logged in.' };
          } else if (!watchlist.watchlist?.length) {
            response = { 
              role: 'bob', 
              content: 'Your watchlist is empty. Add some cars when you spot something worth tracking.',
              actions: [{ label: 'Search Lots', route: '/search-lots' }]
            };
          } else {
            const items = watchlist.watchlist.slice(0, 5);
            const formatted = items.map((item: any) => 
              `• **${item.title}** @ ${item.auction_house}\n  ${item.why || 'On your watch list'}`
            ).join('\n\n');
            response = {
              role: 'bob',
              content: `You're watching ${watchlist.watchlist.length} cars:\n\n${formatted}`,
              data: watchlist,
              actions: [{ label: 'View Full Watchlist', route: '/saved-searches' }]
            };
          }
          break;
        }

        case 'explain': {
          if (selection.lot_id) {
            const explanation = await bobTools.explainWhyListed(selection.lot_id);
            if (!explanation) {
              response = { role: 'bob', content: 'Can\'t explain that one. The lot might not exist or there was an error.' };
            } else {
              const lot = explanation.lot;
              const checks = explanation.eligibility?.checks?.join(', ') || 'all passed';
              const matchStrength = explanation.fingerprint?.match_strength 
                ? `${(explanation.fingerprint.match_strength * 100).toFixed(0)}% match`
                : 'unknown match';
              const comps = explanation.market_context?.comp_count || 0;
              const medianPrice = explanation.market_context?.median_price 
                ? `$${(explanation.market_context.median_price / 1000).toFixed(0)}k`
                : 'unknown';
              
              const upgradeHints = explanation.what_would_upgrade_to_buy?.length
                ? `\n\n📈 Would upgrade to BUY if: ${explanation.what_would_upgrade_to_buy.join(', ')}`
                : '';
              
              response = {
                role: 'bob',
                content: `**${lot.year} ${lot.make} ${lot.model}** at ${lot.auction_house}\n\n` +
                  `✓ Eligibility: ${checks}\n` +
                  `🔗 Fingerprint: ${matchStrength}\n` +
                  `📊 Market: ${comps} comps, median ${medianPrice}\n` +
                  `📌 Recommendation: **${explanation.recommended_action}**${upgradeHints}`,
                data: explanation
              };
            }
          } else {
            response = { 
              role: 'bob', 
              content: 'Click on a specific lot first, then ask me why it\'s there. I need to know which car you\'re looking at.',
              actions: [{ label: 'Search Lots', route: '/search-lots' }]
            };
          }
          break;
        }

        case 'help': {
          response = {
            role: 'bob',
            content: `Here's what I can help with:\n\n` +
              `• **"What opportunities today?"** - Top buying opportunities based on your profile\n` +
              `• **"Show upcoming auctions"** - Auctions ranked by relevance\n` +
              `• **"My watchlist"** - Cars you're tracking\n` +
              `• **"Why is this here?"** - Explain why a lot matches (click lot first)\n\n` +
              `I see what you're looking at and filter based on your dealer profile.`,
            actions: [
              { label: 'Opportunities', action: 'opportunities' },
              { label: 'Auctions', action: 'auctions' }
            ]
          };
          break;
        }

        default: {
          // Try opportunities as default useful response
          const opps = await bobTools.getTodayOpportunities();
          if (opps.items?.length > 0) {
            response = {
              role: 'bob',
              content: `Not sure what you're after, but here's what I've got:\n\n${opps.items.slice(0, 3).map((item: any, i: number) => `${i + 1}. ${formatOpportunity(item)}`).join('\n\n')}\n\nAsk me about opportunities, auctions, or your watchlist.`,
              actions: [{ label: 'View All Opportunities', route: '/opportunities' }]
            };
          } else {
            response = {
              role: 'bob',
              content: `Not sure what you mean, mate. Try:\n• "What opportunities today?"\n• "Show upcoming auctions"\n• "Why is this here?" (when viewing a lot)\n• "My watchlist"`,
            };
          }
        }
      }

      setMessages(prev => [...prev, response]);
    } catch (err) {
      console.error('Bob error:', err);
      setMessages(prev => [...prev, {
        role: 'bob',
        content: 'Something went wrong on my end. Try again in a sec.'
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, user, filters, selection, bobTools]);

  // Handle quick action clicks
  const handleAction = (action: { label: string; route?: string; action?: string }) => {
    if (action.route) {
      navigate(action.route);
      setIsOpen(false);
    } else if (action.action) {
      setInput(action.label);
      setTimeout(() => handleSend(), 100);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <button
          onClick={() => setIsOpen(true)}
          className={cn(
            "fixed bottom-6 right-24 z-50 w-12 h-12 rounded-full shadow-lg",
            "flex items-center justify-center transition-all duration-200",
            "bg-primary text-primary-foreground",
            "hover:scale-105 active:scale-95"
          )}
          aria-label="Open Bob Panel"
        >
          <MessageCircle className="h-5 w-5" />
        </button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-br from-primary to-primary/80 p-4 text-primary-foreground">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-primary-foreground/30">
              <video
                src={bobAvatarVideo}
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1">
              <p className="font-semibold">Bob</p>
              <p className="text-sm opacity-80">Site-Aware Assistant</p>
            </div>
            {selection.lot_id && (
              <div className="flex items-center gap-1 text-xs bg-primary-foreground/20 px-2 py-1 rounded">
                <Eye className="h-3 w-3" />
                <span>Viewing lot</span>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 p-4">
          {!user ? (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Please <a href="/auth" className="underline font-medium">log in</a> to access Bob.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Conversation */}
              {messages.map((msg, i) => (
                <div 
                  key={i}
                  className={cn(
                    "rounded-lg p-3 text-sm",
                    msg.role === 'user' ? "bg-muted ml-8" : "bg-primary/10 mr-4"
                  )}
                >
                  <div className="leading-relaxed whitespace-pre-wrap">
                    {msg.content.split('**').map((part, j) => 
                      j % 2 === 1 ? <strong key={j}>{part}</strong> : part
                    )}
                  </div>
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {msg.actions.map((action, j) => (
                        <Button
                          key={j}
                          variant="secondary"
                          size="sm"
                          onClick={() => handleAction(action)}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Checking the system...</span>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Input */}
        <div className="border-t p-3 flex gap-2">
          <Input
            placeholder="Ask Bob anything..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSend()}
            className="flex-1"
            disabled={!user || isLoading}
          />
          <Button onClick={handleSend} size="icon" disabled={!input.trim() || !user || isLoading}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
