import { useState } from "react";
import { searchOogleBot } from "@/lib/api/ooglebot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";

export function OogleBotSearch() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setResults("");

    try {
      const reply = await searchOogleBot(query);
      setResults(reply);
    } catch (err) {
      console.error("OogleBot search error:", err);
      toast({
        title: "Search failed",
        description:
          err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="h-5 w-5 text-primary" />
            OogleBot — Active Hunt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="e.g. Toyota Commuter 2024 under 80k Australia"
              disabled={loading}
            />
            <Button
              onClick={handleSearch}
              disabled={loading || !query.trim()}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Search"
              )}
            </Button>
          </div>

          {results && (
            <Card className="bg-muted/50">
              <CardContent className="pt-4 prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{results}</ReactMarkdown>
              </CardContent>
            </Card>
          )}

          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium">Example searches:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Toyota HiAce Commuter 2024 under 80k</li>
              <li>Prado GX 250 series under 20000km</li>
              <li>Ford Ranger Wildtrak 2022 low km wholesale</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
