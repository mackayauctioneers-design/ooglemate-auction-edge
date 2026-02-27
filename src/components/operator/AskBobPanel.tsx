import { useState, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

interface Props {
  accountId: string;
}

interface PresetButton {
  key: string;
  label: string;
  category: "wholesale" | "retail";
}

const PRESETS: PresetButton[] = [
  { key: "what_closes_48h", label: "What closes in the next 48 hours?", category: "wholesale" },
  { key: "strongest_margin", label: "Where is strongest margin alignment?", category: "wholesale" },
  { key: "retail_yard_profile", label: "What fits my retail yard profile?", category: "retail" },
  { key: "east_coast_arbitrage", label: "Any east coast arbitrage worth freight?", category: "retail" },
];

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function AskBobPanel({ accountId }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [response, setResponse] = useState<string | null>(null);
  const cacheRef = useRef<Record<string, { text: string; ts: number }>>({});

  const handlePreset = useCallback(async (presetKey: string) => {
    // Check cache
    const cached = cacheRef.current[`${presetKey}:${accountId}`];
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setActivePreset(presetKey);
      setResponse(cached.text);
      setIsOpen(true);
      return;
    }

    setIsLoading(true);
    setActivePreset(presetKey);
    setResponse(null);
    setIsOpen(true);

    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bob-summary`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ preset: presetKey, accountId }),
        }
      );

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        if (resp.status === 429) toast.error("Rate limit exceeded. Try again shortly.");
        else if (resp.status === 402) toast.error("AI usage limit reached.");
        else toast.error(err.error || "Failed to get Bob's summary");
        setIsLoading(false);
        return;
      }

      const data = await resp.json();
      const text = data.response || "No summary generated.";
      setResponse(text);

      // Cache it
      cacheRef.current[`${presetKey}:${accountId}`] = { text, ts: Date.now() };
    } catch (e) {
      console.error("Bob summary error:", e);
      toast.error("Failed to connect to Bob");
    }
    setIsLoading(false);
  }, [accountId]);

  const wholesalePresets = PRESETS.filter(p => p.category === "wholesale");
  const retailPresets = PRESETS.filter(p => p.category === "retail");

  return (
    <Card className="border-border/50">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Ask Bob</span>
        </div>

        {/* Preset buttons */}
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Wholesale</p>
          <div className="flex flex-wrap gap-1.5">
            {wholesalePresets.map(p => (
              <button
                key={p.key}
                onClick={() => handlePreset(p.key)}
                disabled={isLoading}
                className={`text-xs rounded-md border px-2.5 py-1.5 transition-colors ${
                  activePreset === p.key
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                } disabled:opacity-50`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium pt-1">Retail</p>
          <div className="flex flex-wrap gap-1.5">
            {retailPresets.map(p => (
              <button
                key={p.key}
                onClick={() => handlePreset(p.key)}
                disabled={isLoading}
                className={`text-xs rounded-md border px-2.5 py-1.5 transition-colors ${
                  activePreset === p.key
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                } disabled:opacity-50`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Response panel */}
        {(isLoading || response) && (
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full justify-between">
              <span className="font-medium">Bob's Summary</span>
              {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 rounded-md border border-border bg-muted/10 p-3">
                {isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Bob is analysing…
                  </div>
                ) : response ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                    <ReactMarkdown>{response}</ReactMarkdown>
                  </div>
                ) : null}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Future toggle placeholder */}
        <div className="flex items-center gap-2 opacity-40 cursor-not-allowed">
          <input type="checkbox" disabled className="h-3 w-3" />
          <span className="text-[10px] text-muted-foreground">Enable custom question input (coming soon)</span>
        </div>
      </CardContent>
    </Card>
  );
}
