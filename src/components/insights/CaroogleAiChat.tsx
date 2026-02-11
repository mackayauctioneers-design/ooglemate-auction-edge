import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff, Send, Loader2, Search, Star, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { BobSourcingLinks } from "./BobSourcingLinks";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ListingsSearchModal } from "@/components/buy-again/ListingsSearchModal";

interface Props {
  accountId: string;
  dealerName?: string;
}

interface StructuredTarget {
  make: string;
  model: string;
  variant: string | null;
  year_from: number | null;
  year_to: number | null;
  transmission: string | null;
  fuel_type: string | null;
  drive_type: string | null;
  body_type: string | null;
  buy_ceiling: number | null;
  median_profit: number | null;
  median_profit_pct: number | null;
  median_days_to_clear: number | null;
  total_sales: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  tier: "hunt" | "watch";
  spec_label: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  targets?: StructuredTarget[];
}

const EXAMPLE_QUESTIONS = [
  "What should I be hunting right now?",
  "What did I sell once but made serious money on?",
  "Give me 5 targets with buy ceilings",
  "What's my edge at Pickles?",
];

const CONFIDENCE_STYLES: Record<string, string> = {
  HIGH: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  MEDIUM: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  LOW: "bg-muted text-muted-foreground border-border",
};

export function CaroogleAiChat({ accountId, dealerName }: Props) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [searchTarget, setSearchTarget] = useState<StructuredTarget | null>(null);
  const [promotedIds, setPromotedIds] = useState<Set<string>>(new Set());
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const targetKey = (t: StructuredTarget) => `${t.make}|${t.model}|${t.variant || ""}`;

  const streamResponse = useCallback(
    async (question: string) => {
      setIsLoading(true);
      let assistantContent = "";
      let structuredTargets: StructuredTarget[] = [];

      const upsertAssistant = (chunk: string, targets?: StructuredTarget[]) => {
        assistantContent += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) =>
              i === prev.length - 1
                ? { ...m, content: assistantContent, targets: targets || m.targets }
                : m
            );
          }
          return [...prev, { role: "assistant", content: assistantContent, targets }];
        });
      };

      try {
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bob-sales-truth`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({ question, accountId }),
          }
        );

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Request failed" }));
          if (resp.status === 429) toast.error("Rate limit exceeded. Please try again shortly.");
          else if (resp.status === 402) toast.error("AI usage limit reached.");
          else toast.error(err.error || "Failed to get response");
          setIsLoading(false);
          return;
        }

        const reader = resp.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);

            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.startsWith(":") || line.trim() === "") continue;
            if (!line.startsWith("data: ")) continue;

            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") break;

            try {
              const parsed = JSON.parse(jsonStr);

              // Handle structured targets event
              if (parsed.type === "structured_targets") {
                structuredTargets = parsed.targets || [];
                // Create the assistant message with targets immediately
                upsertAssistant("", structuredTargets);
                continue;
              }

              const content = parsed.choices?.[0]?.delta?.content;
              if (content) upsertAssistant(content, structuredTargets);
            } catch {
              buffer = line + "\n" + buffer;
              break;
            }
          }
        }
      } catch (e) {
        console.error("CaroogleAi error:", e);
        toast.error("Failed to connect to CaroogleAi");
      }
      setIsLoading(false);
    },
    [accountId]
  );

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    streamResponse(trimmed);
  }, [input, isLoading, streamResponse]);

  const handleExampleClick = (q: string) => {
    if (isLoading) return;
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    streamResponse(q);
  };

  const handlePromote = async (target: StructuredTarget) => {
    const key = targetKey(target);
    if (promotedIds.has(key)) return;

    try {
      const { error } = await supabase.from("fingerprint_targets").insert({
        account_id: accountId,
        make: target.make,
        model: target.model,
        variant: target.variant,
        year_from: target.year_from,
        year_to: target.year_to,
        transmission: target.transmission,
        fuel_type: target.fuel_type,
        drive_type: target.drive_type,
        body_type: target.body_type,
        median_profit: target.median_profit,
        median_profit_pct: target.median_profit_pct,
        median_days_to_clear: target.median_days_to_clear,
        total_sales: target.total_sales,
        confidence_level: target.confidence,
        spec_completeness: target.spec_label === "identical" ? 5 : 2,
        target_score: target.total_sales * (target.median_profit || 0),
        origin: "bob",
        status: "active",
        last_promoted_at: new Date().toISOString(),
      });

      if (error) {
        // Might already exist — try update
        if (error.code === "23505") {
          toast.info("Target already exists in Buy Again Targets");
        } else {
          throw error;
        }
      } else {
        toast.success(`Promoted ${target.make} ${target.model} to Buy Again Targets`);
      }
      setPromotedIds((prev) => new Set([...prev, key]));
    } catch (e: any) {
      toast.error(e.message || "Failed to promote target");
    }
  };

  const handleWatch = async (target: StructuredTarget) => {
    const key = targetKey(target);
    if (watchedIds.has(key) || !user) {
      if (!user) toast.error("Sign in to add to watchlist");
      return;
    }

    try {
      const { error } = await supabase.from("sourcing_watchlist").insert({
        user_id: user.id,
        account_id: accountId,
        make: target.make,
        model: target.model,
        variant: target.variant,
        year_min: target.year_from,
        year_max: target.year_to,
        drivetrain: target.drive_type,
        fuel_type: target.fuel_type,
        transmission: target.transmission,
        confidence_level: target.confidence,
        watch_type: target.tier === "hunt" ? "hunt" : "watch",
        originating_insight: `Bob recommended: ${target.make} ${target.model} ${target.variant || ""}`.trim(),
      });

      if (error) throw error;
      toast.success(`Watching ${target.make} ${target.model}`);
      setWatchedIds((prev) => new Set([...prev, key]));
    } catch (e: any) {
      toast.error(e.message || "Failed to add to watchlist");
    }
  };

  const toggleVoice = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition not supported");
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-AU";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      setInput(event.results[0][0].transcript);
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening]);

  return (
    <div className="space-y-3">
      {messages.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-[500px] overflow-y-auto space-y-3 rounded-lg border border-border bg-muted/10 p-3"
        >
          {messages.map((msg, i) => (
            <div key={i} className={`text-sm ${msg.role === "user" ? "text-foreground font-medium" : "text-muted-foreground"}`}>
              {msg.role === "user" ? (
                <p className="text-primary">🗣 {msg.content}</p>
              ) : (
                <>
                  {msg.content && (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}

                  {/* Structured action targets */}
                  {!isLoading && msg.targets && msg.targets.length > 0 && (
                    <TargetActions
                      targets={msg.targets}
                      promotedIds={promotedIds}
                      watchedIds={watchedIds}
                      onSearch={setSearchTarget}
                      onPromote={handlePromote}
                      onWatch={handleWatch}
                      targetKey={targetKey}
                    />
                  )}

                  {!isLoading && msg.content.length > 50 && accountId && (
                    <BobSourcingLinks bobResponse={msg.content} accountId={accountId} />
                  )}
                </>
              )}
            </div>
          ))}
          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              CaroogleAi is thinking…
            </div>
          )}
        </div>
      )}

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => handleExampleClick(q)}
              className="text-xs rounded-full border border-border bg-muted/30 px-3 py-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="icon" onClick={toggleVoice} className={isListening ? "border-primary text-primary" : ""}>
          {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          placeholder="Ask CaroogleAi a question about your sales…"
          className="min-h-[40px] max-h-[80px] resize-none"
          rows={1}
        />
        <Button onClick={handleSend} disabled={!input.trim() || isLoading} size="icon">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>

      {/* Listings search modal */}
      {searchTarget && (
        <ListingsSearchModal
          target={{
            id: "",
            account_id: accountId,
            make: searchTarget.make,
            model: searchTarget.model,
            variant: searchTarget.variant,
            year_from: searchTarget.year_from,
            year_to: searchTarget.year_to,
            transmission: searchTarget.transmission,
            fuel_type: searchTarget.fuel_type,
            drive_type: searchTarget.drive_type,
            body_type: searchTarget.body_type,
            median_profit: searchTarget.median_profit,
            median_profit_pct: searchTarget.median_profit_pct,
            median_days_to_clear: searchTarget.median_days_to_clear,
            median_sale_price: null,
            median_km: null,
            total_sales: searchTarget.total_sales,
            confidence_level: searchTarget.confidence,
            spec_completeness: searchTarget.spec_label === "identical" ? 5 : 2,
            target_score: 0,
            origin: "bob",
            status: "active",
            source_candidate_id: null,
            last_promoted_at: null,
            created_at: "",
            updated_at: "",
          }}
          open={true}
          onOpenChange={(open) => { if (!open) setSearchTarget(null); }}
        />
      )}
    </div>
  );
}

// ── Structured target action strip ──
function TargetActions({
  targets,
  promotedIds,
  watchedIds,
  onSearch,
  onPromote,
  onWatch,
  targetKey,
}: {
  targets: StructuredTarget[];
  promotedIds: Set<string>;
  watchedIds: Set<string>;
  onSearch: (t: StructuredTarget) => void;
  onPromote: (t: StructuredTarget) => void;
  onWatch: (t: StructuredTarget) => void;
  targetKey: (t: StructuredTarget) => string;
}) {
  // Show hunt tier first, then watch
  const sorted = [...targets].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === "hunt" ? -1 : 1;
    return b.total_sales - a.total_sales;
  });

  const display = sorted.slice(0, 6);

  return (
    <div className="space-y-2 pt-3 border-t border-border/50 mt-3">
      <p className="text-xs font-medium text-foreground">
        🎯 Bob's structured targets — take action
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {display.map((t, i) => {
          const key = targetKey(t);
          const isPromoted = promotedIds.has(key);
          const isWatched = watchedIds.has(key);
          const confStyle = CONFIDENCE_STYLES[t.confidence] || CONFIDENCE_STYLES.LOW;

          const dna = [
            t.year_from && t.year_to && t.year_from !== t.year_to
              ? `${t.year_from}–${t.year_to}`
              : t.year_from
                ? `${t.year_from}`
                : null,
            t.make,
            t.model,
            t.variant,
            t.drive_type,
          ].filter(Boolean).join(" ");

          return (
            <div
              key={i}
              className="rounded-md border border-border bg-card/50 p-2.5 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{dna}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <Badge variant="outline" className={`text-[10px] ${confStyle}`}>
                      {t.confidence}
                    </Badge>
                    {t.spec_label !== "identical" && (
                      <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20">
                        {t.spec_label}
                      </Badge>
                    )}
                  </div>
                </div>
                {t.buy_ceiling != null && (
                  <span className="text-xs font-mono text-primary shrink-0">
                    ≤${t.buy_ceiling.toLocaleString()}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                {t.total_sales > 0 && <span>{t.total_sales} sale{t.total_sales > 1 ? "s" : ""}</span>}
                {t.median_profit != null && <span>${t.median_profit.toLocaleString()} profit</span>}
                {t.median_days_to_clear != null && <span>{t.median_days_to_clear}d clear</span>}
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2 gap-1"
                  onClick={() => onSearch(t)}
                >
                  <Search className="h-3 w-3" /> Search
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2 gap-1"
                  onClick={() => onWatch(t)}
                  disabled={isWatched}
                >
                  <Star className="h-3 w-3" /> {isWatched ? "Watching" : "Watch"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2 gap-1"
                  onClick={() => onPromote(t)}
                  disabled={isPromoted}
                >
                  <CheckCircle2 className="h-3 w-3" /> {isPromoted ? "Promoted" : "Promote"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
