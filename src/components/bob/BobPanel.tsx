import { useRef, useEffect, useState, useCallback, forwardRef, useMemo } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Send, Loader2, X, Trash2,
  ExternalLink, Eye, Search, ArrowRight, Volume2, VolumeX, Mic, Phone, PhoneOff,
  AlertTriangle, TrendingUp, Clock, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBob, BobMessage } from '@/contexts/BobContext';
import { useAuth } from '@/contexts/AuthContext';
import { useBobVoiceAgent } from '@/hooks/useBobVoiceAgent';
import { BobAvatar } from './BobAvatar';
import { BobWaveform } from './BobWaveform';
import { BobVoiceFAB } from './BobVoiceFAB';
import { BobVoiceOverlay } from './BobVoiceOverlay';
import ReactMarkdown from 'react-markdown';

// ============================================================================
// BOB PANEL v5 — AI Co-Pilot with Voice Agent (text · push-to-talk · hands-free)
// ============================================================================

// --- Sub-components (unchanged from v4) -----------------------------------

function ConfidenceBadge({ level }: { level: string | null }) {
  if (!level || level === 'none') return null;
  const config = {
    high: { label: 'High Confidence', className: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30' },
    medium: { label: 'Medium', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30' },
    low: { label: 'Low Data', className: 'bg-muted text-muted-foreground border-border' },
  }[level] || { label: level, className: 'bg-muted text-muted-foreground border-border' };

  return (
    <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 border", config.className)}>
      {config.label}
    </Badge>
  );
}

function VehicleResultCard({ vehicle, onAction }: { vehicle: any; onAction?: (action: string, vehicle: any) => void }) {
  const priceFormatted = vehicle.price ? `$${Number(vehicle.price).toLocaleString()}` : 'Price N/A';
  const kmFormatted = vehicle.km ? `${(vehicle.km / 1000).toFixed(0)}k km` : '';
  const profitFormatted = vehicle.estimated_profit
    ? `~$${Number(vehicle.estimated_profit).toLocaleString()}`
    : null;
  const dtsFormatted = vehicle.avg_days_to_sell ? `${vehicle.avg_days_to_sell}d avg` : null;

  return (
    <div className="border border-border rounded-lg p-3 bg-card hover:bg-accent/30 transition-all duration-200 animate-fade-in">
      <div className="flex gap-3">
        {vehicle.image_url && (
          <div className="w-20 h-16 rounded-md overflow-hidden flex-shrink-0 bg-muted">
            <img src={vehicle.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <h4 className="font-semibold text-sm text-foreground truncate">
              {vehicle.year} {vehicle.make} {vehicle.model}
              {vehicle.variant ? ` ${vehicle.variant}` : ''}
            </h4>
            <div className="flex gap-1 flex-shrink-0">
              {vehicle.fingerprint_match && (
                <Badge variant="default" className="text-[9px] px-1.5 py-0">
                  <ShieldCheck className="h-2.5 w-2.5 mr-0.5" />Match
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{priceFormatted}</span>
            {kmFormatted && <span>• {kmFormatted}</span>}
            {vehicle.location && <span>• {vehicle.location}</span>}
          </div>

          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
            {vehicle.source && (
              <span className="capitalize bg-muted px-1.5 py-0.5 rounded text-[10px]">{vehicle.source}</span>
            )}
            {profitFormatted && (
              <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-0.5">
                <TrendingUp className="h-3 w-3" />{profitFormatted}
              </span>
            )}
            {dtsFormatted && (
              <span className="flex items-center gap-0.5">
                <Clock className="h-3 w-3" />{dtsFormatted}
              </span>
            )}
            <ConfidenceBadge level={vehicle.confidence} />
          </div>

          {vehicle.risk_flags?.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {vehicle.risk_flags.map((flag: string, i: number) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive flex items-center gap-0.5">
                  <AlertTriangle className="h-2.5 w-2.5" />{flag}
                </span>
              ))}
            </div>
          )}

          {vehicle.fit_reason && (
            <p className="text-[11px] text-muted-foreground mt-1 italic leading-tight">{vehicle.fit_reason}</p>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 mt-2 border-t border-border/50 pt-2">
        {vehicle.listing_url && (
          <Button variant="ghost" size="sm" className="h-6 text-xs px-2" asChild>
            <a href={vehicle.listing_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3 mr-1" />Open
            </a>
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => onAction?.('similar', vehicle)}>
          <Search className="h-3 w-3 mr-1" />Similar
        </Button>
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => onAction?.('watch', vehicle)}>
          <Eye className="h-3 w-3 mr-1" />Watch
        </Button>
      </div>
    </div>
  );
}

function ToolResultsDisplay({ toolResults, onVehicleAction }: { toolResults: any[]; onVehicleAction?: (action: string, vehicle: any) => void }) {
  if (!toolResults?.length) return null;

  return (
    <div className="space-y-2 mt-2">
      {toolResults.map((tr, i) => {
        const result = tr.result;
        if (!result) return null;

        if (tr.function_name === 'search_vehicles' && result.results?.length) {
          return (
            <div key={i} className="space-y-2">
              {result.results.slice(0, 8).map((v: any, j: number) => (
                <VehicleResultCard key={j} vehicle={v} onAction={onVehicleAction} />
              ))}
              {result.total > 8 && (
                <p className="text-xs text-muted-foreground text-center py-1">
                  + {result.total - 8} more results
                </p>
              )}
            </div>
          );
        }

        if (tr.function_name === 'get_buy_recommendations' && result.recommendations?.length) {
          return (
            <div key={i} className="space-y-2">
              {result.recommendations.map((v: any, j: number) => (
                <VehicleResultCard key={j} vehicle={v} onAction={onVehicleAction} />
              ))}
            </div>
          );
        }

        if (tr.function_name === 'find_replacement' && result.replacements?.length) {
          return (
            <div key={i}>
              <p className="text-xs text-muted-foreground mb-2 font-medium">
                Replacements for: {result.reference}
              </p>
              <div className="space-y-2">
                {result.replacements.map((v: any, j: number) => (
                  <VehicleResultCard key={j} vehicle={v} onAction={onVehicleAction} />
                ))}
              </div>
            </div>
          );
        }

        if (tr.function_name === 'create_watch' && result.watch_id) {
          return (
            <div key={i} className="border border-border rounded-lg p-3 bg-card animate-fade-in">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium text-foreground">Watch active: {result.label}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Watching for {result.profile?.make} {result.profile?.model}
                {result.profile?.year_min ? ` ${result.profile.year_min}+` : ''}
                {result.profile?.km_max ? ` under ${(result.profile.km_max / 1000).toFixed(0)}k km` : ''}
              </p>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

function MessageBubble({ message, isSpeaking, onVehicleAction }: {
  message: BobMessage; isSpeaking?: boolean; onVehicleAction?: (action: string, vehicle: any) => void;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={cn("flex gap-2.5 animate-fade-in", isUser ? "flex-row-reverse" : "flex-row")}>
      {!isUser && <BobAvatar size="sm" isSpeaking={isSpeaking} className="mt-0.5" />}
      <div className={cn(
        "max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm",
        isUser
          ? "bg-foreground text-background rounded-br-sm"
          : "bg-muted text-foreground rounded-bl-sm",
      )}>
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:mb-1.5 [&_p]:mt-0 [&_ul]:my-1 [&_li]:my-0.5 [&_strong]:text-foreground">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
        {!isUser && message.tool_results && (
          <ToolResultsDisplay toolResults={message.tool_results} onVehicleAction={onVehicleAction} />
        )}
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex gap-2.5 items-start animate-fade-in">
      <BobAvatar size="sm" isThinking className="mt-0.5" />
      <div className="bg-muted rounded-xl rounded-bl-sm px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span className="text-xs text-muted-foreground ml-1">Bob is searching...</span>
        </div>
      </div>
    </div>
  );
}

// --- MAIN PANEL ---------------------------------------------------------------

export function BobPanel() {
  const { user } = useAuth();
  const {
    isOpen, setIsOpen,
    messages, isStreaming,
    sendMessage, clearMessages,
    quickActions, dealerName,
    pageContext, setPageContext,
  } = useBob();

  const [input, setInput] = useState('');
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Latest assistant message for voice playback
  const latestAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i];
    }
    return null;
  }, [messages]);

  const voiceAgent = useBobVoiceAgent({
    sendMessage,
    isStreaming,
    latestAssistantMessage: voiceMuted ? null : latestAssistant?.content || null,
    latestAssistantMessageId: latestAssistant?.id || null,
  });

  // Open the panel automatically when entering hands-free mode
  useEffect(() => {
    if (voiceAgent.mode === 'agent') {
      setOverlayOpen(true);
    } else {
      setOverlayOpen(false);
    }
  }, [voiceAgent.mode]);

  // Publish voice mode into Bob's page context so bob-chat shapes the response
  // for the ear when TTS is in play.
  useEffect(() => {
    setPageContext({ voice_mode: voiceAgent.mode });
  }, [voiceAgent.mode, setPageContext]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isStreaming]);

  // Focus input
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 200);
  }, [isOpen]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const text = input;
    setInput('');
    voiceAgent.stopSpeaking();
    await sendMessage(text);
  };

  const handleQuickAction = async (prompt: string) => {
    voiceAgent.stopSpeaking();
    await sendMessage(prompt);
  };

  const handleVehicleAction = useCallback((action: string, vehicle: any) => {
    switch (action) {
      case 'similar':
        sendMessage(`Find me more vehicles like this ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.variant || ''}`);
        break;
      case 'watch':
        sendMessage(`Watch for vehicles like this ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.variant || ''}`);
        break;
    }
  }, [sendMessage]);

  if (!user) return null;

  const lastMessage = messages[messages.length - 1];
  const isLastAssistant = lastMessage?.role === 'assistant';
  const showInterimInInput = voiceAgent.isListening && !!voiceAgent.interimText && voiceAgent.mode !== 'agent';

  return (
    <>
      {/* FAB stack — only when panel and overlay are closed */}
      {!isOpen && !overlayOpen && (
        <BobVoiceFAB
          voiceState={voiceAgent.state}
          sttSupported={voiceAgent.sttSupported}
          isListening={voiceAgent.isListening}
          onOpenPanel={() => setIsOpen(true)}
          onPushToTalk={voiceAgent.togglePushToTalk}
          onStartAgent={voiceAgent.startAgentMode}
        />
      )}

      {/* Hands-free full-screen overlay */}
      <BobVoiceOverlay
        isOpen={overlayOpen}
        state={voiceAgent.state}
        interimText={voiceAgent.interimText}
        lastBobMessage={latestAssistant?.content || null}
        dealerName={dealerName}
        onEndCall={() => {
          voiceAgent.endAgentMode();
          setOverlayOpen(false);
        }}
        onMuteToggle={() => setVoiceMuted((m) => !m)}
        isMuted={voiceMuted}
      />

      {/* Chat sheet */}
      <Sheet
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open && voiceAgent.mode !== 'agent') {
            voiceAgent.stopSpeaking();
          }
        }}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-[420px] p-0 flex flex-col gap-0 border-l border-border"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-border bg-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <BobAvatar
                  size="sm"
                  isThinking={isStreaming}
                  isSpeaking={voiceAgent.isSpeaking}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-sm text-foreground">Bob</h2>
                    {voiceAgent.isSpeaking && <BobWaveform active bars={4} className="ml-1" />}
                    {isStreaming && !voiceAgent.isSpeaking && (
                      <span className="text-[10px] text-muted-foreground animate-pulse">searching...</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {pageContext.page_title} • {dealerName}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {voiceAgent.sttSupported && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-green-600 hover:text-green-700"
                    onClick={voiceAgent.startAgentMode}
                    title="Start hands-free conversation"
                  >
                    <Phone className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  onClick={() => {
                    setVoiceMuted((m) => !m);
                    if (voiceAgent.isSpeaking) voiceAgent.stopSpeaking();
                  }}
                  title={voiceMuted ? "Enable voice" : "Mute voice"}
                >
                  {voiceMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </Button>
                {messages.length > 0 && (
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"
                    onClick={() => { clearMessages(); voiceAgent.stopSpeaking(); }}
                    title="Clear conversation"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"
                  onClick={() => setIsOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-4">
              {messages.length === 0 && (
                <div className="space-y-5">
                  <div className="text-center py-4">
                    <BobAvatar size="lg" className="mx-auto mb-3" />
                    <p className="text-base text-foreground font-semibold">
                      G'day {dealerName}.
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      What do you need?
                    </p>
                    {voiceAgent.sttSupported && (
                      <p className="text-xs text-muted-foreground mt-2 flex items-center justify-center gap-1">
                        <Mic className="h-3 w-3" /> Tap the mic to talk, or the phone for hands-free
                      </p>
                    )}
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

              {messages.map((msg, idx) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isSpeaking={voiceAgent.isSpeaking && msg.role === 'assistant' && idx === messages.length - 1}
                  onVehicleAction={handleVehicleAction}
                />
              ))}

              {isStreaming && (!isLastAssistant || !lastMessage?.content) && (
                <ThinkingIndicator />
              )}
            </div>
          </div>

          {/* Quick actions strip mid-conversation */}
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

          {/* Input bar */}
          <div className="border-t border-border p-3 bg-card">
            {voiceAgent.isSpeaking && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                  Bob is speaking…
                </span>
                <BobWaveform active bars={6} className="ml-auto" />
                <button onClick={voiceAgent.stopSpeaking} className="text-xs text-destructive hover:underline">
                  Stop
                </button>
              </div>
            )}
            {voiceAgent.isListening && !voiceAgent.isSpeaking && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs text-muted-foreground">
                  {voiceAgent.interimText ? `"${voiceAgent.interimText}"` : 'Listening…'}
                </span>
                <BobWaveform active bars={6} className="ml-auto" />
              </div>
            )}
            <div className="flex gap-2 items-center">
              {voiceAgent.sttSupported && (
                <button
                  onClick={voiceAgent.togglePushToTalk}
                  className={cn(
                    "relative flex items-center justify-center rounded-full transition-all duration-200 w-10 h-10 flex-shrink-0",
                    voiceAgent.isListening
                      ? "bg-red-500 text-white shadow-lg shadow-red-500/30"
                      : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  aria-label={voiceAgent.isListening ? "Stop listening" : "Start voice input"}
                >
                  {voiceAgent.isListening && (
                    <span className="absolute inset-0 rounded-full bg-red-500/40 animate-ping" />
                  )}
                  <Mic className="h-4 w-4 relative z-10" />
                </button>
              )}
              <Input
                ref={inputRef}
                placeholder={
                  showInterimInInput
                    ? voiceAgent.interimText
                    : voiceAgent.isListening
                    ? "Listening…"
                    : "Ask Bob anything…"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                className={cn(
                  "flex-1 bg-background",
                  showInterimInInput && "italic text-muted-foreground",
                )}
                disabled={isStreaming || voiceAgent.isListening}
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
