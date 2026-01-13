import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OperatorLayout } from "@/components/layout/OperatorLayout";
import {
  ShieldCheck,
  FlaskConical,
  Play,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const REGIONS = [
  "NSW_SYDNEY_METRO",
  "NSW_REGIONAL",
  "VIC_MELBOURNE_METRO",
  "VIC_REGIONAL",
  "QLD_BRISBANE_METRO",
  "QLD_REGIONAL",
  "SA_ADELAIDE_METRO",
  "WA_PERTH_METRO",
  "TAS",
  "NT",
  "ACT",
];

const PLATFORMS = [
  { value: "bidsonline", label: "BidsOnline" },
  { value: "asp", label: "ASP Auction Portal" },
  { value: "pickles", label: "Pickles" },
  { value: "manheim", label: "Manheim" },
  { value: "custom", label: "Custom / Other" },
];

type PreflightResult = {
  status: string;
  reason: string;
  suggested_profile?: string;
  markers?: Record<string, unknown>;
};

type DryRunResult = {
  success: boolean;
  sample_count?: number;
  year_gate?: { kept: number; dropped: number; minYear: number };
  sample?: unknown[];
  raw?: unknown;
  error?: string;
};

export default function AddAuctionSourcePage() {
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [listUrl, setListUrl] = useState("");
  const [regionHint, setRegionHint] = useState("NSW_SYDNEY_METRO");
  const [platform, setPlatform] = useState("bidsonline");

  const [step, setStep] = useState<"input" | "preflight" | "create" | "done">("input");
  const [loading, setLoading] = useState(false);

  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);
  const [suggestedProfile, setSuggestedProfile] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [createdSourceKey, setCreatedSourceKey] = useState<string | null>(null);

  const sourceKey = useMemo(() => slugify(displayName), [displayName]);

  async function runPreflight() {
    if (!listUrl) {
      toast.error("Please enter a URL first");
      return;
    }
    setLoading(true);
    setPreflightResult(null);
    setSuggestedProfile(null);

    try {
      // First create a temporary source to run preflight on
      const tempKey = `temp_${Date.now()}`;
      await supabase.from("auction_sources").insert({
        source_key: tempKey,
        display_name: "Temp Preflight Check",
        platform,
        list_url: listUrl,
        region_hint: regionHint,
        enabled: false,
        preflight_status: "pending",
      });

      const { data, error } = await supabase.functions.invoke("auction-preflight", {
        body: { source_key: tempKey },
      });

      // Clean up temp source
      await supabase.from("auction_sources").delete().eq("source_key", tempKey);

      if (error) throw error;

      const result: PreflightResult = {
        status: data?.results?.[0]?.preflight_status || data?.status || "unknown",
        reason: data?.results?.[0]?.preflight_reason || data?.reason || "",
        suggested_profile: data?.results?.[0]?.suggested_profile || data?.suggested_profile,
        markers: data?.results?.[0]?.markers || data?.markers,
      };

      setPreflightResult(result);
      if (result.suggested_profile) {
        setSuggestedProfile(result.suggested_profile);
      }

      if (result.status === "pass") {
        toast.success("Preflight passed!");
        setStep("preflight");
      } else {
        toast.warning(`Preflight: ${result.status} - ${result.reason}`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      toast.error(`Preflight failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  async function createSource() {
    if (!displayName || !listUrl || !sourceKey) {
      toast.error("Please fill in all required fields");
      return;
    }

    setLoading(true);
    try {
      // Create the auction source via RPC
      const { error: rpcError } = await supabase.rpc("create_auction_source" as never, {
        p_source_key: sourceKey,
        p_display_name: displayName,
        p_platform: platform,
        p_list_url: listUrl,
        p_region_hint: regionHint,
      } as never);

      if (rpcError) throw rpcError;

      // Apply suggested parser profile if available
      if (suggestedProfile) {
        await supabase
          .from("auction_sources")
          .update({ parser_profile: suggestedProfile })
          .eq("source_key", sourceKey);
      }

      setCreatedSourceKey(sourceKey);
      toast.success("Auction source created!");
      setStep("create");

      // Run a dry run automatically
      const { data, error } = await supabase.functions.invoke("auction-dry-run", {
        body: { source_key: sourceKey },
      });

      if (error) {
        toast.warning("Dry run failed, but source was created");
        setDryRunResult({ success: false, error: error.message });
      } else {
        setDryRunResult(data);
        if (data?.sample_count > 0) {
          toast.success(`Dry run found ${data.sample_count} sample vehicles!`);
        }
      }

      setStep("done");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      toast.error(`Create failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  async function runLiveIngest() {
    if (!createdSourceKey) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("auction-run-now", {
        body: { source_key: createdSourceKey },
      });
      if (error) throw error;
      toast.success(`Live ingest complete: ${data?.result?.lots_found ?? "?"} lots`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      toast.error(`Live ingest failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  function goToHealthPage() {
    navigate("/operator/ingestion-health");
  }

  return (
    <OperatorLayout>
      <div className="max-w-3xl mx-auto py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Add Auction Source</h1>
          <p className="text-muted-foreground">
            Register a new auction feed to start ingesting listings
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-sm">
          <Badge variant={step === "input" ? "default" : "outline"}>1. Enter Details</Badge>
          <span className="text-muted-foreground">→</span>
          <Badge variant={step === "preflight" ? "default" : "outline"}>2. Preflight</Badge>
          <span className="text-muted-foreground">→</span>
          <Badge variant={step === "create" || step === "done" ? "default" : "outline"}>
            3. Create & Validate
          </Badge>
        </div>

        {/* Input Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Source Details</CardTitle>
            <CardDescription>Enter the auction source information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="displayName">Display Name *</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Auto Auctions AAV"
                disabled={step === "done"}
              />
              {sourceKey && (
                <p className="text-xs text-muted-foreground">
                  Source key: <code className="bg-muted px-1 rounded">{sourceKey}</code>
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="listUrl">List URL *</Label>
              <Input
                id="listUrl"
                value={listUrl}
                onChange={(e) => setListUrl(e.target.value)}
                placeholder="https://example.com/auctions"
                disabled={step === "done"}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Platform</Label>
                <Select value={platform} onValueChange={setPlatform} disabled={step === "done"}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>Region</Label>
                <Select value={regionHint} onValueChange={setRegionHint} disabled={step === "done"}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {step === "input" && (
              <div className="flex gap-2 pt-2">
                <Button onClick={runPreflight} disabled={loading || !listUrl || !displayName}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 mr-2" />
                  )}
                  Run Preflight
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Preflight Result */}
        {preflightResult && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                {preflightResult.status === "pass" ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : preflightResult.status === "fail" ? (
                  <XCircle className="h-5 w-5 text-destructive" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-yellow-500" />
                )}
                Preflight Result
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge
                  variant={preflightResult.status === "pass" ? "default" : "secondary"}
                  className={preflightResult.status === "pass" ? "bg-green-600" : ""}
                >
                  {preflightResult.status}
                </Badge>
                <span className="text-sm text-muted-foreground">{preflightResult.reason}</span>
              </div>

              {suggestedProfile && (
                <div className="flex items-center gap-2">
                  <span className="text-sm">Suggested profile:</span>
                  <Badge variant="outline">{suggestedProfile}</Badge>
                </div>
              )}

              {preflightResult.markers && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Show preflight markers
                  </summary>
                  <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-[200px]">
                    {JSON.stringify(preflightResult.markers, null, 2)}
                  </pre>
                </details>
              )}

              {step === "preflight" && (
                <div className="flex gap-2 pt-2">
                  <Button onClick={createSource} disabled={loading}>
                    {loading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    Create & Validate
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Dry Run Result */}
        {dryRunResult && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                Dry Run Result
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {dryRunResult.success ? (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge variant="secondary">
                      Samples: {dryRunResult.sample_count ?? 0}
                    </Badge>
                    {dryRunResult.year_gate && (
                      <>
                        <Badge className="bg-green-600/20 text-green-400">
                          Kept: {dryRunResult.year_gate.kept}
                        </Badge>
                        <Badge variant="destructive">
                          Dropped (old): {dryRunResult.year_gate.dropped}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Min year: {dryRunResult.year_gate.minYear}
                        </span>
                      </>
                    )}
                  </div>

                  {dryRunResult.sample && dryRunResult.sample.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Show sample vehicles ({dryRunResult.sample.length})
                      </summary>
                      <ScrollArea className="h-[200px] mt-2">
                        <pre className="text-xs bg-muted p-2 rounded">
                          {JSON.stringify(dryRunResult.sample, null, 2)}
                        </pre>
                      </ScrollArea>
                    </details>
                  )}
                </>
              ) : (
                <div className="text-destructive text-sm">
                  Dry run failed: {dryRunResult.error || "Unknown error"}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Done Actions */}
        {step === "done" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Source Created Successfully
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The auction source <code className="bg-muted px-1 rounded">{createdSourceKey}</code>{" "}
                has been created. You can now run a live ingest or configure the schedule.
              </p>

              <div className="flex gap-2 flex-wrap">
                <Button onClick={runLiveIngest} disabled={loading}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Run Live Ingest
                </Button>
                <Button variant="outline" onClick={goToHealthPage}>
                  Go to Ingestion Health
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setStep("input");
                    setDisplayName("");
                    setListUrl("");
                    setPreflightResult(null);
                    setDryRunResult(null);
                    setCreatedSourceKey(null);
                    setSuggestedProfile(null);
                  }}
                >
                  Add Another
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </OperatorLayout>
  );
}
