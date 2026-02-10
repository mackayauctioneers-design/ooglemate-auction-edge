import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { BobSourcingLinks } from "./BobSourcingLinks";

interface Props {
  accountId: string;
  dealerName?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

const EXAMPLE_QUESTIONS = [
  "What were my most profitable cars?",
  "What did I sell quickly and repeatedly?",
  "What are some cars I only sold once but made good money on?",
  "What should I be trying to buy again?",
];

export function CaroogleAiChat({ accountId, dealerName }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const streamResponse = useCallback(
    async (question: string) => {
      setIsLoading(true);
      let assistantContent = "";

      const upsertAssistant = (chunk: string) => {
        assistantContent += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: assistantContent } : m
            );
          }
          return [...prev, { role: "assistant", content: assistantContent }];
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
          if (resp.status === 429) {
            toast.error("Rate limit exceeded. Please try again shortly.");
          } else if (resp.status === 402) {
            toast.error("AI usage limit reached. Please add credits.");
          } else {
            toast.error(err.error || "Failed to get response");
          }
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
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) upsertAssistant(content);
            } catch {
              buffer = line + "\n" + buffer;
              break;
            }
          }
        }
      } catch (e) {
        console.error("Caroogle AI error:", e);
        toast.error("Failed to connect to Caroogle AI");
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

  const toggleVoice = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition is not supported in this browser");
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
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
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
      {/* Messages */}
      {messages.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-80 overflow-y-auto space-y-3 rounded-lg border border-border bg-muted/10 p-3"
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`text-sm ${
                msg.role === "user" ? "text-foreground font-medium" : "text-muted-foreground"
              }`}
            >
              {msg.role === "user" ? (
                <p className="text-primary">🗣 {msg.content}</p>
              ) : (
                <>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
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
              Caroogle AI is thinking…
            </div>
          )}
        </div>
      )}

      {/* Example questions */}
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

      {/* Input */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={toggleVoice}
          className={isListening ? "border-primary text-primary" : ""}
        >
          {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask Caroogle AI a question about your sales…"
          className="min-h-[40px] max-h-[80px] resize-none"
          rows={1}
        />
        <Button onClick={handleSend} disabled={!input.trim() || isLoading} size="icon">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
