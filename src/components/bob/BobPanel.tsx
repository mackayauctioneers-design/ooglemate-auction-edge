import { useRef, useEffect, useState } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Send, Loader2, X, MessageSquare, Trash2,
  ExternalLink, Eye, Plus, Search, ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBob, BobMessage } from '@/contexts/BobContext';
import { useAuth } from '@/contexts/AuthContext';
import ReactMarkdown from 'react-markdown';

// ============================================================================
// BOB PANEL v2 — Production AI Buying Assistant
// ============================================================================

function VehicleResultCard({ vehicle }: { vehicle: any }) {
  const priceFormatted = vehicle.price ? `$${Number(vehicle.price).toLocaleString()}` : 'Price N/A';
  const kmFormatted = vehicle.km ? `${(vehicle.km / 1000).toFixed(0)}k km` : '';
  const profitFormatted = vehicle.estimated_profit ? `~$${Number(vehicle.estimated_profit).toLocaleString()} est. profit` : '';

  return (
    <div className="border border-border rounded-lg p-3 bg-card hover:bg-accent/50 transition-colors">
      <div className="flex gap-3">
        {vehicle.image_url && (
          <div className="w-20 h-14 rounded overflow-hidden flex-shrink-0 bg-muted">
            <img src={vehicle.image_url} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-semibold text-sm text-foreground truncate">
              {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.variant || ''}
            </h4>
            {vehicle.fingerprint_match && (
              <Badge variant="default" className="text-[10px] px-1.5 py-0 flex-shrink-0">Match</Badge>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{priceFormatted}</span>
            {kmFormatted && <span>• {kmFormatted}</span>}
            {vehicle.location && <span>• {vehicle.location}</span>}
          </div>
          {vehicle.source && (
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span className="capitalize">{vehicle.source}</span>
              {vehicle.price_badge && <Badge variant="secondary" className="text-[10px] px-1 py-0">{vehicle.price_badge}</Badge>}
              {profitFormatted && <span className="text-emerald-600 dark:text-emerald-400 font-medium">{profitFormatted}</span>}
            </div>
          )}
          {vehicle.fit_reason && (
            <p className="text-xs text-muted-foreground mt-1 italic">{vehicle.fit_reason}</p>
          )}
        </div>
      </div>
      <div className="flex gap-1.5 mt-2">
        {vehicle.listing_url && (
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" asChild>
            <a href={vehicle.listing_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3 mr-1" />View
            </a>
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2">
          <Search className="h-3 w-3 mr-1" />Similar
        </Button>
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2">
          <Eye className="h-3 w-3 mr-1" />Watch
        </Button>
      </div>
    </div>
  );
}

function ToolResultsDisplay({ toolResults }: { toolResults: any[] }) {
  if (!toolResults?.length) return null;

  return (
    <div className="space-y-2 mt-2">
      {toolResults.map((tr, i) => {
        const result = tr.result;
        if (!result) return null;

        // Vehicle search results
        if (tr.function_name === 'search_vehicles' && result.results?.length) {
          return (
            <div key={i} className="space-y-2">
              {result.results.slice(0, 8).map((v: any, j: number) => (
                <VehicleResultCard key={j} vehicle={v} />
              ))}
              {result.total > 8 && (
                <p className="text-xs text-muted-foreground text-center">
                  + {result.total - 8} more results
                </p>
              )}
            </div>
          );
        }

        // Buy recommendations
        if (tr.function_name === 'get_buy_recommendations' && result.recommendations?.length) {
          return (
            <div key={i} className="space-y-2">
              {result.recommendations.slice(0, 6).map((v: any, j: number) => (
                <VehicleResultCard key={j} vehicle={v} />
              ))}
            </div>
          );
        }

        // Replacement results
        if (tr.function_name === 'find_replacement' && result.replacements?.length) {
          return (
            <div key={i}>
              <p className="text-xs text-muted-foreground mb-2">
                Replacements for: {result.reference}
              </p>
              <div className="space-y-2">
                {result.replacements.map((v: any, j: number) => (
                  <VehicleResultCard key={j} vehicle={v} />
                ))}
              </div>
            </div>
          );
        }

        // Watch created
        if (tr.function_name === 'create_watch' && result.watch_id) {
          return (
            <div key={i} className="border border-border rounded-lg p-3 bg-card">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Watch created: {result.label}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Watching for {result.profile?.make} {result.profile?.model}
                {result.profile?.year_min && ` ${result.profile.year_min}+`}
                {result.profile?.km_max && ` under ${(result.profile.km_max/1000).toFixed(0)}k km`}
              </p>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

function MessageBubble({ message }: { message: BobMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn(
        "max-w-[90%] rounded-xl px-3.5 py-2.5 text-sm",
        isUser
          ? "bg-primary text-primary-foreground rounded-br-sm"
          : "bg-muted text-foreground rounded-bl-sm"
      )}>
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:mb-1.5 [&_p]:mt-0 [&_ul]:my-1 [&_li]:my-0.5 [&_strong]:text-foreground">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        {!isUser && message.tool_results && (
          <ToolResultsDisplay toolResults={message.tool_results} />
        )}
      </div>
    </div>
  );
}

export function BobPanel() {
  const { user } = useAuth();
  const {
    isOpen, setIsOpen,
    messages, isStreaming,
    sendMessage, clearMessages,
    quickActions, dealerName,
    pageContext,
  } = useBob();

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isStreaming]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const text = input;
    setInput('');
    await sendMessage(text);
  };

  const handleQuickAction = async (prompt: string) => {
    await sendMessage(prompt);
  };

  if (!user) return null;

  return (
    <>
      {/* Floating trigger button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className={cn(
            "fixed bottom-6 right-6 z-50",
            "w-14 h-14 rounded-2xl shadow-lg",
            "flex items-center justify-center",
            "bg-foreground text-background",
            "hover:scale-105 active:scale-95 transition-all duration-200",
            "border-2 border-background/20"
          )}
          aria-label="Open Bob"
        >
          <div className="flex flex-col items-center">
            <MessageSquare className="h-5 w-5" />
            <span className="text-[9px] font-bold mt-0.5 tracking-wide">BOB</span>
          </div>
        </button>
      )}

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[420px] p-0 flex flex-col gap-0 border-l-2 border-foreground/10"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-foreground text-background flex items-center justify-center font-bold text-sm">
                B
              </div>
              <div>
                <h2 className="font-semibold text-sm text-foreground">Bob</h2>
                <p className="text-[11px] text-muted-foreground">
                  {pageContext.page_title} • {dealerName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  onClick={clearMessages}
                  title="Clear conversation"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Messages area */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-4">
              {/* Empty state with quick actions */}
              {messages.length === 0 && (
                <div className="space-y-4">
                  <div className="text-center py-6">
                    <div className="w-16 h-16 rounded-2xl bg-foreground text-background flex items-center justify-center font-bold text-2xl mx-auto mb-3">
                      B
                    </div>
                    <p className="text-sm text-foreground font-medium">
                      G'day {dealerName}.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      What do you need?
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-1">
                      Quick actions
                    </p>
                    <div className="grid gap-1.5">
                      {quickActions.map((action, i) => (
                        <button
                          key={i}
                          onClick={() => handleQuickAction(action.prompt)}
                          className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors text-left group"
                        >
                          <span className="text-base flex-shrink-0">{action.icon || '💬'}</span>
                          <span className="text-sm text-foreground flex-1">{action.label}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Conversation */}
              {messages.map(msg => (
                <MessageBubble key={msg.id} message={msg} />
              ))}

              {/* Streaming indicator */}
              {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="text-xs">Thinking...</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick actions strip (when in conversation) */}
          {messages.length > 0 && !isStreaming && (
            <div className="px-3 py-2 border-t border-border/50 flex gap-1.5 overflow-x-auto">
              {quickActions.slice(0, 3).map((action, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs whitespace-nowrap flex-shrink-0"
                  onClick={() => handleQuickAction(action.prompt)}
                >
                  {action.icon} {action.label}
                </Button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-border p-3 bg-card">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                placeholder="Ask Bob anything..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                className="flex-1 bg-background"
                disabled={isStreaming}
              />
              <Button
                onClick={handleSend}
                size="icon"
                disabled={!input.trim() || isStreaming}
                className="flex-shrink-0"
              >
                {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
