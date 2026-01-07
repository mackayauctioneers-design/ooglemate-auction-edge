import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { 
  MessageCircle, Send, Loader2, 
  TrendingUp, TrendingDown, Minus, Clock, 
  HelpCircle, ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import bobAvatarVideo from '@/assets/bob-avatar.mp4';

// ============================================================================
// BOB PANEL - Dealer-facing chat + daily brief + help system
// ============================================================================

interface MarketPulse {
  category: string;
  status: 'hot' | 'stable' | 'cooling';
  description: string;
}

interface StockComparison {
  category: string;
  status: 'faster' | 'inline' | 'slower';
  description: string;
}

interface DailyBrief {
  greeting: string;
  marketPulse: MarketPulse[];
  stockVsMarket: StockComparison[];
  suggestedFocus: string[];
  slowMoverCount: number;
  opportunityCount: number;
}

interface ChatMessage {
  role: 'user' | 'bob';
  content: string;
  actions?: Array<{
    label: string;
    route?: string;
    action?: string;
  }>;
}

// Help topics with dealer-safe responses
const HELP_TOPICS: Record<string, { 
  keywords: string[]; 
  response: string; 
  actions?: Array<{ label: string; route?: string }>;
}> = {
  fingerprints: {
    keywords: ['fingerprint', 'fingerprints', 'what i buy', 'buying pattern', 'my cars'],
    response: "Fingerprints are your buying patterns based on what you've sold. They help me spot cars that match your sweet spot - same makes, models, and spec you've had success with.",
    actions: [{ label: 'View My Fingerprints', route: '/fingerprints' }]
  },
  cleared: {
    keywords: ['cleared', 'clearing', 'sold', 'gone', 'removed'],
    response: "Cleared means a car has left the market - could be sold, withdrawn, or passed in. I track clearing times to understand how fast different cars move in your area."
  },
  hotStableCooling: {
    keywords: ['hot', 'stable', 'cooling', 'market pulse', 'demand', 'trending'],
    response: "I group the market into Hot (moving fast), Stable (normal pace), and Cooling (slowing down). This helps you know what's worth chasing and what might need a harder look."
  },
  inventory: {
    keywords: ['inventory', 'stock', 'listings', 'catalogue', 'auction'],
    response: "Your inventory view shows what's in the pipeline - upcoming auctions, current listings, and matched opportunities based on your fingerprints.",
    actions: [{ label: 'Search Listings', route: '/search-lots' }]
  },
  opportunities: {
    keywords: ['opportunities', 'matches', 'today', 'what to buy'],
    response: "I scan the lanes for cars that match your fingerprints. When I find one, it shows up in Opportunities. These are the ones worth your time.",
    actions: [{ label: 'View Opportunities', route: '/opportunities' }]
  },
  slowMovers: {
    keywords: ['slow', 'slow mover', 'sitting', 'not selling', 'stuck'],
    response: "Slow movers are cars that have been listed longer than typical for their category. Worth keeping an eye on - sometimes the reserve softens.",
    actions: [{ label: 'Show Slow Movers', route: '/search-lots?filter=slow' }]
  },
  valuation: {
    keywords: ['valo', 'valuation', 'price', 'worth', 'value', 'how much'],
    response: "Need a quick price check? Head to VALO and tell me about the car. I'll check the book and give you a straight answer.",
    actions: [{ label: 'Get a VALO', route: '/valo' }]
  },
  alerts: {
    keywords: ['alert', 'alerts', 'notification', 'notify', 'watch'],
    response: "I send alerts when something important happens - new matches, price drops, or cars about to auction. You can manage what you get notified about.",
    actions: [{ label: 'View Alerts', route: '/alerts' }]
  },
  troubleshoot: {
    keywords: ['help', 'issue', 'problem', 'not working', 'broken', 'error'],
    response: "Having trouble? First thing - check if you're logged in properly. If things still aren't right, try refreshing the page. For data issues, the team can look into it.",
    actions: [{ label: 'Contact Support', route: '/help' }]
  },
  savedSearches: {
    keywords: ['saved search', 'saved searches', 'watch list', 'watching'],
    response: "Saved searches run automatically and ping you when something matches. Great for specific specs you're always hunting.",
    actions: [{ label: 'Manage Saved Searches', route: '/saved-searches' }]
  }
};

export function BobPanel() {
  const { isAdmin, dealerProfile, user } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [dailyBrief, setDailyBrief] = useState<DailyBrief | null>(null);
  const [showBrief, setShowBrief] = useState(true);
  const [accountNotLinked, setAccountNotLinked] = useState(false);

  const dealerName = dealerProfile?.dealer_name || 'mate';

  // Fetch daily brief from edge function (JWT is auto-included by supabase client)
  const fetchDailyBrief = useCallback(async () => {
    if (!user) {
      setAccountNotLinked(true);
      return;
    }
    
    setIsLoading(true);
    setAccountNotLinked(false);
    try {
      // Body params are for fallback/debug only - server derives from JWT
      const { data, error } = await supabase.functions.invoke('bob-daily-brief', {
        body: { 
          // These are ignored server-side for dealers (derived from JWT)
          // Only used as fallback for internal debugging
          isAdmin 
        }
      });

      if (error) throw error;

      if (data?.accountNotLinked) {
        setAccountNotLinked(true);
      }

      if (data?.brief) {
        setDailyBrief(data.brief);
      }
    } catch (err) {
      console.error('Failed to fetch daily brief:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user, isAdmin]);

  // Handle panel open
  const handleOpen = useCallback(async () => {
    setIsOpen(true);
    if (!dailyBrief) {
      await fetchDailyBrief();
    }
  }, [dailyBrief, fetchDailyBrief]);

  // Find matching help topic
  const findHelpTopic = (query: string): typeof HELP_TOPICS[keyof typeof HELP_TOPICS] | null => {
    const queryLower = query.toLowerCase();
    for (const [, topic] of Object.entries(HELP_TOPICS)) {
      if (topic.keywords.some(kw => queryLower.includes(kw))) {
        return topic;
      }
    }
    return null;
  };

  // Handle user message
  const handleSend = useCallback(async () => {
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput('');
    setShowBrief(false);

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    // Check for help topic match
    const topic = findHelpTopic(userMessage);

    if (topic) {
      setMessages(prev => [...prev, { 
        role: 'bob', 
        content: topic.response,
        actions: topic.actions
      }]);
    } else if (userMessage.toLowerCase().includes('today') || userMessage.toLowerCase().includes('brief')) {
      // Show daily brief
      setShowBrief(true);
      if (!dailyBrief) {
        await fetchDailyBrief();
      }
      setMessages(prev => [...prev, { 
        role: 'bob', 
        content: "Here's what I've got for you today. Check the brief above for the full picture."
      }]);
    } else {
      // Generic response
      setMessages(prev => [...prev, { 
        role: 'bob', 
        content: "Not sure about that one, mate. Try asking about fingerprints, opportunities, valuations, or what's hot in the market. Or just say 'what have you got today' for your daily rundown."
      }]);
    }
  }, [input, dailyBrief, fetchDailyBrief]);

  // Handle action button click
  const handleAction = (action: { label: string; route?: string; action?: string }) => {
    if (action.route) {
      navigate(action.route);
      setIsOpen(false);
    }
  };

  // Render market pulse status icon
  const renderPulseIcon = (status: 'hot' | 'stable' | 'cooling') => {
    switch (status) {
      case 'hot':
        return <TrendingUp className="h-4 w-4 text-red-500" />;
      case 'stable':
        return <Minus className="h-4 w-4 text-amber-500" />;
      case 'cooling':
        return <TrendingDown className="h-4 w-4 text-blue-500" />;
    }
  };

  // Render stock comparison icon
  const renderStockIcon = (status: 'faster' | 'inline' | 'slower') => {
    switch (status) {
      case 'faster':
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'inline':
        return <Minus className="h-4 w-4 text-muted-foreground" />;
      case 'slower':
        return <Clock className="h-4 w-4 text-amber-500" />;
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <button
          onClick={handleOpen}
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
            <div>
              <p className="font-semibold">Bob</p>
              <p className="text-sm opacity-80">Your Dealer Assistant</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 p-4">
          {!user ? (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Please <a href="/auth" className="underline font-medium">log in</a> to access your daily brief.
              </p>
            </div>
          ) : accountNotLinked ? (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Your account isn't linked to a dealership yet. Please contact admin to complete setup.
              </p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Daily Brief Card */}
              {showBrief && dailyBrief && (
                <div className="bg-muted/50 rounded-lg p-4 space-y-4">
                  <p className="text-sm font-medium">{dailyBrief.greeting}</p>

                  {/* Market Pulse */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                      Market Pulse
                    </p>
                    <div className="space-y-1">
                      {dailyBrief.marketPulse.map((item, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          {renderPulseIcon(item.status)}
                          <span className="font-medium">{item.category}</span>
                          <span className="text-muted-foreground">· {item.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Stock vs Market */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                      Your Stock vs Market
                    </p>
                    <div className="space-y-1">
                      {dailyBrief.stockVsMarket.map((item, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          {renderStockIcon(item.status)}
                          <span className="font-medium">{item.category}</span>
                          <span className="text-muted-foreground">· {item.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Suggested Focus */}
                  {dailyBrief.suggestedFocus.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                        Suggested Focus
                      </p>
                      <ul className="space-y-1">
                        {dailyBrief.suggestedFocus.map((item, i) => (
                          <li key={i} className="text-sm flex items-start gap-2">
                            <ChevronRight className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-2">
                    {dailyBrief.slowMoverCount > 0 && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleAction({ label: 'Slow Movers', route: '/search-lots?status=fatigue' })}
                        className="flex-1"
                      >
                        <Clock className="h-4 w-4 mr-1" />
                        Slow Movers ({dailyBrief.slowMoverCount})
                      </Button>
                    )}
                    {dailyBrief.opportunityCount > 0 && (
                      <Button 
                        variant="default" 
                        size="sm"
                        onClick={() => handleAction({ label: 'Opportunities', route: '/opportunities' })}
                        className="flex-1"
                      >
                        <TrendingUp className="h-4 w-4 mr-1" />
                        Opportunities ({dailyBrief.opportunityCount})
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Conversation */}
              {messages.map((msg, i) => (
                <div 
                  key={i}
                  className={cn(
                    "rounded-lg p-3 text-sm",
                    msg.role === 'user' ? "bg-muted ml-8" : "bg-primary/10 mr-4"
                  )}
                >
                  <p className="leading-relaxed">{msg.content}</p>
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
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

              {/* Quick Actions */}
              {messages.length === 0 && !showBrief && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Quick questions:</p>
                  <div className="flex flex-wrap gap-2">
                    {['What are fingerprints?', 'Show opportunities', 'What\'s hot?'].map((q) => (
                      <Button
                        key={q}
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setInput(q);
                          handleSend();
                        }}
                      >
                        <HelpCircle className="h-3 w-3 mr-1" />
                        {q}
                      </Button>
                    ))}
                  </div>
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
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            className="flex-1"
            disabled={!user}
          />
          <Button onClick={handleSend} size="icon" disabled={!input.trim() || !user}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
