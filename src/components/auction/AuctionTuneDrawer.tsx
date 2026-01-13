import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { FlaskConical, Play, ShieldCheck, Save, Loader2 } from "lucide-react";

type AuctionSourceStat = {
  source_key: string;
  display_name: string;
  platform: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: AuctionSourceStat | null;
  onRefresh?: () => void;
};

const PROFILES = [
  "asp_search_results",
  "bidsonline_default",
  "bidsonline_grid",
  "bidsonline_table",
  "custom_f3",
  "custom_valley",
  "pickles_grid",
  "manheim_default",
];

export function AuctionTuneDrawer({ open, onOpenChange, src, onRefresh }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [listUrl, setListUrl] = useState("");
  const [parserProfile, setParserProfile] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [notes, setNotes] = useState("");

  const [preflightStatus, setPreflightStatus] = useState<string | null>(null);
  const [preflightReason, setPreflightReason] = useState<string | null>(null);
  const [validationStatus, setValidationStatus] = useState<string | null>(null);

  const [debugOut, setDebugOut] = useState<unknown>(null);
  const [debugAction, setDebugAction] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !src) return;

    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("auction_sources")
        .select(
          "list_url,parser_profile,enabled,notes,preflight_status,preflight_reason,validation_status"
        )
        .eq("source_key", src.source_key)
        .single();

      setListUrl(data?.list_url || "");
      setParserProfile(data?.parser_profile || "");
      setEnabled(!!data?.enabled);
      setNotes(data?.notes || "");
      setPreflightStatus(data?.preflight_status || null);
      setPreflightReason(data?.preflight_reason || null);
      setValidationStatus(data?.validation_status || null);
      setDebugOut(null);
      setDebugAction(null);
      setLoading(false);
    })();
  }, [open, src?.source_key]);

  const title = useMemo(() => {
    if (!src) return "";
    return `${src.display_name} (${src.source_key})`;
  }, [src]);

  async function doPreflight() {
    if (!src) return;
    setSaving(true);
    setDebugAction("preflight");
    setDebugOut(null);
    try {
      const { data, error } = await supabase.functions.invoke("auction-preflight", {
        body: { source_key: src.source_key },
      });
      if (error) throw error;
      setDebugOut(data);
      setPreflightStatus(data?.preflight_status || data?.status || null);
      toast.success("Preflight complete");
      onRefresh?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown";
      toast.error(`Preflight failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  async function doDryRun() {
    if (!src) return;
    setSaving(true);
    setDebugAction("dry_run");
    setDebugOut(null);
    try {
      const { data, error } = await supabase.functions.invoke("auction-dry-run", {
        body: { source_key: src.source_key },
      });
      if (error) throw error;
      setDebugOut(data);
      toast.success("Dry run complete (see output)");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown";
      toast.error(`Dry run failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  async function doRunNow() {
    if (!src) return;
    setSaving(true);
    setDebugAction("run_now");
    setDebugOut(null);
    try {
      const { data, error } = await supabase.functions.invoke("auction-run-now", {
        body: { source_key: src.source_key },
      });
      if (error) throw error;
      setDebugOut(data);
      toast.success("Run Now complete");
      onRefresh?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown";
      toast.error(`Run Now failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveConfig() {
    if (!src) return;
    setSaving(true);
    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;
      if (!token) throw new Error("Not logged in");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auction-update-source`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            source_key: src.source_key,
            list_url: listUrl,
            parser_profile: parserProfile || null,
            enabled,
            notes,
          }),
        }
      );

      const out = await res.json();
      if (!res.ok) throw new Error(out?.error || "Save failed");

      toast.success("Configuration saved");
      onRefresh?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown";
      toast.error(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="border-b pb-4">
          <DrawerTitle>Auction Tune Mode</DrawerTitle>
          <DrawerDescription>{title || "Select a source"}</DrawerDescription>
        </DrawerHeader>

        {!src || loading ? (
          <div className="p-6 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="flex-1 px-4">
            <div className="grid gap-5 py-4">
              {/* Status badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{src.platform}</Badge>
                {preflightStatus && (
                  <Badge
                    variant={preflightStatus === "pass" ? "default" : "secondary"}
                    className={preflightStatus === "pass" ? "bg-green-600" : ""}
                  >
                    Preflight: {preflightStatus}
                  </Badge>
                )}
                {validationStatus && (
                  <Badge variant="outline">Validation: {validationStatus}</Badge>
                )}
                {preflightReason && (
                  <span className="text-xs text-muted-foreground">
                    ({preflightReason})
                  </span>
                )}
              </div>

              {/* Config form */}
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="listUrl">List URL</Label>
                  <Input
                    id="listUrl"
                    value={listUrl}
                    onChange={(e) => setListUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="parserProfile">Parser Profile</Label>
                  <Input
                    id="parserProfile"
                    list="parserProfiles"
                    value={parserProfile}
                    onChange={(e) => setParserProfile(e.target.value)}
                    placeholder="asp_search_results / bidsonline_default / …"
                  />
                  <datalist id="parserProfiles">
                    {PROFILES.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                  <p className="text-xs text-muted-foreground">
                    Tip: For *auto-auctions.com.au* style pages use{" "}
                    <strong>asp_search_results</strong>.
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Internal notes about this source…"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    id="enabled"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                  />
                  <Label htmlFor="enabled">Enabled</Label>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button onClick={saveConfig} disabled={saving}>
                  {saving && debugAction === null ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save
                </Button>
                <Button variant="secondary" onClick={doPreflight} disabled={saving}>
                  {saving && debugAction === "preflight" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 mr-2" />
                  )}
                  Preflight
                </Button>
                <Button variant="secondary" onClick={doDryRun} disabled={saving}>
                  {saving && debugAction === "dry_run" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FlaskConical className="h-4 w-4 mr-2" />
                  )}
                  Dry Run
                </Button>
                <Button onClick={doRunNow} disabled={saving}>
                  {saving && debugAction === "run_now" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Run Now
                </Button>
              </div>

              {/* Debug output */}
              <div className="rounded-md border p-3">
                <div className="text-sm font-medium mb-2">Output</div>
                {!debugOut ? (
                  <div className="text-xs text-muted-foreground">
                    Run Preflight/Dry Run/Run Now to see output here.
                  </div>
                ) : (
                  <ScrollArea className="max-h-[300px]">
                    <pre className="text-xs whitespace-pre-wrap break-all">
                      {JSON.stringify(debugOut, null, 2)}
                    </pre>
                  </ScrollArea>
                )}
              </div>
            </div>
          </ScrollArea>
        )}
      </DrawerContent>
    </Drawer>
  );
}
