import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

// ============================================================================
// BOB CONTEXT — Rich page + dealer context for the AI buying assistant
// ============================================================================

export interface BobPageContext {
  route: string;
  page_type: string;
  page_title: string;
  // Entity IDs visible on page
  vehicle_ids?: string[];
  dealer_id?: string;
  auction_event_ids?: string[];
  // Selected entity
  selected_vehicle?: {
    id: string;
    make?: string;
    model?: string;
    variant?: string;
    year?: number;
    km?: number;
    price?: number;
    source?: string;
    score?: number;
  } | null;
  // Filters
  filters?: Record<string, any>;
  search_terms?: string;
  sort_state?: string;
  // Page metrics
  metrics?: Record<string, any>;
  // Voice agent mode (off | push-to-talk | agent) — when set, bob-chat is told
  // to respond in a short, spoken style suitable for TTS.
  voice_mode?: 'off' | 'push-to-talk' | 'agent';
}

export interface BobMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_results?: any[];
  timestamp: number;
}

export interface BobQuickAction {
  label: string;
  prompt: string;
  icon?: string;
}

// VALO form fill event
export interface ValoFormFillData {
  make?: string;
  model?: string;
  year?: string;
  km?: string;
  badge?: string;
  condition?: string;
  description?: string;
  autoRun?: boolean;
}

interface BobContextValue {
  // Panel state
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  
  // Page context
  pageContext: BobPageContext;
  setPageContext: (ctx: Partial<BobPageContext>) => void;
  
  // Conversation
  messages: BobMessage[];
  isStreaming: boolean;
  sendMessage: (text: string) => Promise<void>;
  clearMessages: () => void;
  greet: (text: string) => void;
  
  // Quick actions
  quickActions: BobQuickAction[];
  
  // Dealer info
  dealerProfileId: string | null;
  dealerName: string;

  // VALO form fill
  onValoFormFill: (callback: ((data: ValoFormFillData) => void) | null) => void;
}

const BobContext = createContext<BobContextValue | null>(null);

// Route -> page type mapping
function getPageType(route: string): { type: string; title: string } {
  if (route === '/' || route === '/dealer-home') return { type: 'home', title: 'Dashboard' };
  if (route === '/trading-desk') return { type: 'trading_desk', title: 'Trading Desk' };
  if (route === '/sales-upload') return { type: 'sales_upload', title: 'My Sales' };
  if (route === '/sales-insights') return { type: 'sales_insights', title: 'Sales Insights' };
  if (route === '/deals') return { type: 'deals_list', title: 'Closed Deals' };
  if (route.startsWith('/deals/')) return { type: 'deal_detail', title: 'Deal Detail' };
  if (route === '/ooglebot') return { type: 'search', title: 'OogleBot Search' };
  if (route === '/valo') return { type: 'valuation', title: 'VALO Valuation' };
  if (route === '/my-hunts') return { type: 'hunts', title: 'My Hunts' };
  if (route === '/upcoming-auctions') return { type: 'auctions', title: 'Upcoming Auctions' };
  if (route === '/search-lots') return { type: 'search_lots', title: 'Search Lots' };
  if (route === '/opportunities') return { type: 'opportunities', title: 'Opportunities' };
  if (route.startsWith('/dealer/opportunities')) return { type: 'opportunity_feed', title: 'Opportunity Feed' };
  if (route === '/intelligence') return { type: 'intelligence', title: 'Dealer Intelligence' };
  if (route.startsWith('/operator')) return { type: 'operator', title: 'Operator Tools' };
  return { type: 'other', title: route };
}

// Context-aware quick actions
function getQuickActions(pageType: string, hasSelection: boolean): BobQuickAction[] {
  const base: BobQuickAction[] = [
    { label: 'What should I buy today?', prompt: 'What should I buy today?', icon: '🎯' },
  ];

  switch (pageType) {
    case 'trading_desk':
      return [
        { label: 'Best deals right now', prompt: 'What are the best deals on the trading desk right now?', icon: '🔥' },
        { label: "What's worth bidding on?", prompt: 'Which auction vehicles should I bid on?', icon: '🏷️' },
        ...(hasSelection ? [{ label: 'Why this vehicle?', prompt: 'Why is this vehicle ranked here? Explain the score.', icon: '🔍' }] : []),
        ...base,
      ];
    case 'sales_insights':
      return [
        { label: 'My best profit bands', prompt: 'What are my strongest profit bands?', icon: '📈' },
        { label: 'Where do I get hurt?', prompt: 'Where do I lose money? What should I avoid?', icon: '⚠️' },
        { label: 'Best KM ranges', prompt: 'What KM ranges work best for me?', icon: '🔧' },
        ...base,
      ];
    case 'deal_detail':
      return [
        { label: 'Find another like this', prompt: 'Find me another vehicle like this one.', icon: '🔄' },
        { label: 'Replace this car', prompt: 'I just sold this. Find me a replacement.', icon: '🔁' },
        { label: 'Watch for similar', prompt: 'Watch the market for similar stock.', icon: '👁️' },
      ];
    case 'search':
      return [
        { label: 'Explain results', prompt: 'Explain these search results. Why are they ranked this way?', icon: '🔍' },
        ...base,
      ];
    case 'auctions':
      return [
        { label: 'Which auctions are hot?', prompt: 'Which upcoming auctions have the best stock for me?', icon: '🔥' },
        { label: 'What should I bid on?', prompt: 'What should I bid on in the upcoming auctions?', icon: '🏷️' },
        ...base,
      ];
    case 'valuation':
      return [
        { label: 'Do a valo', prompt: 'I need to value a trade-in. Ask me about the vehicle.', icon: '💰' },
        { label: 'Quick appraise', prompt: 'Quick appraise — I\'ll describe the vehicle.', icon: '⚡' },
        { label: 'What\'s it worth?', prompt: 'What is this vehicle worth on the market right now?', icon: '📊' },
        ...base,
      ];
    case 'opportunity_feed':
      return [
        { label: 'Why #1?', prompt: 'Why is the top opportunity ranked number one?', icon: '🏆' },
        { label: 'Compare top 3', prompt: 'Compare the top 3 opportunities for me.', icon: '⚖️' },
        ...base,
      ];
    case 'home':
      return [
        ...base,
        { label: 'My performance summary', prompt: 'Give me a performance summary of my dealership.', icon: '📊' },
        { label: 'Explain this page', prompt: 'What am I looking at here?', icon: '❓' },
      ];
    default:
      return [
        ...base,
        { label: 'Explain this page', prompt: 'What am I looking at on this page?', icon: '❓' },
        { label: 'Search vehicles', prompt: 'I want to search for vehicles.', icon: '🔎' },
      ];
  }
}

export function BobContextProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { user, dealerProfile } = useAuth();
  
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<BobMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pageContextOverrides, setPageContextOverrides] = useState<Partial<BobPageContext>>({});
  const abortRef = useRef<AbortController | null>(null);
  const valoFormFillRef = useRef<((data: ValoFormFillData) => void) | null>(null);

  const onValoFormFill = useCallback((callback: ((data: ValoFormFillData) => void) | null) => {
    valoFormFillRef.current = callback;
  }, []);

  const dealerProfileId = dealerProfile?.dealer_profile_id || user?.id || null;
  const dealerName = dealerProfile?.dealer_name || 'mate';

  // Build page context from route + overrides
  const { type: pageType, title: pageTitle } = getPageType(location.pathname);
  const pageContext: BobPageContext = {
    route: location.pathname,
    page_type: pageType,
    page_title: pageTitle,
    dealer_id: dealerProfileId || undefined,
    ...pageContextOverrides,
  };

  const setPageContext = useCallback((ctx: Partial<BobPageContext>) => {
    setPageContextOverrides(prev => ({ ...prev, ...ctx }));
  }, []);

  // Reset page context overrides on navigation
  useEffect(() => {
    setPageContextOverrides({});
  }, [location.pathname]);

  const quickActions = getQuickActions(pageType, !!pageContextOverrides.selected_vehicle);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const greet = useCallback((text: string) => {
    setMessages(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
      },
    ]);
    setIsOpen(true);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !dealerProfileId) return;

    const userMsg: BobMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);

    // Build conversation history for AI
    const conversationHistory = [...messages, userMsg].map(m => ({
      role: m.role,
      content: m.content,
    }));

    const assistantId = crypto.randomUUID();
    let assistantContent = "";
    let toolResults: any[] = [];

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const chatUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bob-chat`;
      const resp = await fetch(chatUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: conversationHistory,
          dealer_profile_id: dealerProfileId,
          page_context: pageContext,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errData.error || `HTTP ${resp.status}`);
      }

      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(jsonStr);
            
            // Handle tool results event
            if (parsed.type === "tool_results") {
              toolResults = parsed.results || [];
              // Check for valo_form_fill tool results
              for (const tr of toolResults) {
                if (tr.tool === "start_valo" && tr.result?.form_fill && valoFormFillRef.current) {
                  valoFormFillRef.current(tr.result.form_fill);
                }
              }
              continue;
            }

            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantContent += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.id === assistantId) {
                  return prev.map(m => m.id === assistantId ? { ...m, content: assistantContent, tool_results: toolResults } : m);
                }
                return [...prev, {
                  id: assistantId,
                  role: 'assistant' as const,
                  content: assistantContent,
                  tool_results: toolResults,
                  timestamp: Date.now(),
                }];
              });
            }
          } catch {
            // Partial JSON, re-buffer
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      // Final flush
      if (buffer.trim()) {
        for (let raw of buffer.split("\n")) {
          if (!raw || !raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) assistantContent += content;
          } catch {}
        }
      }

      // Ensure final message is set
      if (assistantContent) {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.id === assistantId) {
            return prev.map(m => m.id === assistantId ? { ...m, content: assistantContent, tool_results: toolResults } : m);
          }
          return [...prev, {
            id: assistantId,
            role: 'assistant' as const,
            content: assistantContent,
            tool_results: toolResults,
            timestamp: Date.now(),
          }];
        });
      }

    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('[Bob] Stream error:', err);
      setMessages(prev => [...prev, {
        id: assistantId,
        role: 'assistant' as const,
        content: `Something went wrong: ${err.message || 'Unknown error'}. Try again.`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [messages, dealerProfileId, pageContext]);

  return (
    <BobContext.Provider value={{
      isOpen,
      setIsOpen,
      pageContext,
      setPageContext,
      messages,
      isStreaming,
      sendMessage,
      clearMessages,
      greet,
      quickActions,
      dealerProfileId,
      dealerName,
      onValoFormFill,
    }}>
      {children}
    </BobContext.Provider>
  );
}

export function useBob() {
  const ctx = useContext(BobContext);
  if (!ctx) throw new Error('useBob must be used within BobContextProvider');
  return ctx;
}

// Hook for pages to push context into Bob
export function useBobPageContext() {
  const { setPageContext } = useBob();
  return { setPageContext };
}
