import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Mail, Send, Bell, Copy, ExternalLink, CheckCircle2 } from "lucide-react";

const TELEGRAM_BOT_USERNAME = "Lovablemackabot";

function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function NotificationSetupModal() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"intro" | "telegram">("intro");

  const [email, setEmail] = useState("");
  const [enableEmail, setEnableEmail] = useState(true);
  const [enableTelegram, setEnableTelegram] = useState(false);
  const [enablePush, setEnablePush] = useState(false);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [telegramLinked, setTelegramLinked] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("dealer_notification_settings")
        .select("setup_completed_at, email, telegram_chat_id, preferred_channels, push_enabled")
        .eq("dealer_id", user.id)
        .maybeSingle();
      if (!alive) return;
      if (!data?.setup_completed_at) {
        setEmail(data?.email || user.email || "");
        setEnableEmail((data?.preferred_channels ?? ["email"]).includes("email"));
        setEnableTelegram((data?.preferred_channels ?? []).includes("telegram"));
        setEnablePush(!!data?.push_enabled);
        setTelegramLinked(!!data?.telegram_chat_id);
        setOpen(true);
      }
    })();
    return () => { alive = false; };
  }, [user]);

  // Poll for telegram link confirmation while on step=telegram
  useEffect(() => {
    if (step !== "telegram" || !user || telegramLinked) return;
    const id = setInterval(async () => {
      const { data } = await supabase
        .from("dealer_notification_settings")
        .select("telegram_chat_id")
        .eq("dealer_id", user.id)
        .maybeSingle();
      if (data?.telegram_chat_id) {
        setTelegramLinked(true);
        toast.success("Telegram connected!");
      }
    }, 3000);
    return () => clearInterval(id);
  }, [step, user, telegramLinked]);

  async function startTelegramLink() {
    if (!user) return;
    const code = genCode();
    const { error } = await supabase
      .from("dealer_notification_settings")
      .upsert({ dealer_id: user.id, telegram_link_code: code }, { onConflict: "dealer_id" });
    if (error) { toast.error("Couldn't generate link code"); return; }
    setLinkCode(code);
    setStep("telegram");
  }

  async function requestBrowserPush() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    const res = await Notification.requestPermission();
    return res === "granted";
  }

  async function save() {
    if (!user) return;
    setLoading(true);
    const channels: string[] = [];
    if (enableEmail) channels.push("email");
    if (enableTelegram) channels.push("telegram");
    if (enablePush) {
      const ok = await requestBrowserPush();
      if (ok) channels.push("push");
      else setEnablePush(false);
    }
    if (channels.length === 0) channels.push("email");

    const { error } = await supabase
      .from("dealer_notification_settings")
      .upsert({
        dealer_id: user.id,
        email: email || user.email || null,
        preferred_channels: channels,
        push_enabled: enablePush,
        notify_star: true,
        setup_completed_at: new Date().toISOString(),
      }, { onConflict: "dealer_id" });

    setLoading(false);
    if (error) { toast.error("Couldn't save preferences"); return; }
    toast.success("Notifications set up — we'll keep you posted.");
    setOpen(false);
  }

  if (!user) return null;

  const deepLink = linkCode
    ? `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${linkCode}`
    : "";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) save(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" /> How should we reach you?
          </DialogTitle>
          <DialogDescription>
            When you star a car, Carbitrage scrapes it and watches for price drops &amp; auction reminders. Pick where you want pings.
          </DialogDescription>
        </DialogHeader>

        {step === "intro" && (
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-accent/40">
              <Checkbox checked={enableEmail} onCheckedChange={(v) => setEnableEmail(!!v)} className="mt-0.5" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 font-medium"><Mail className="h-4 w-4" /> Email</div>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@dealership.com.au" type="email" />
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-accent/40">
              <Checkbox checked={enableTelegram} onCheckedChange={(v) => setEnableTelegram(!!v)} className="mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2 font-medium"><Send className="h-4 w-4" /> Telegram</div>
                <p className="text-xs text-muted-foreground mt-1">Instant DMs from our bot — best for auction-imminent pings.</p>
                {enableTelegram && !telegramLinked && (
                  <Button type="button" size="sm" variant="outline" className="mt-2" onClick={startTelegramLink}>
                    Connect Telegram
                  </Button>
                )}
                {telegramLinked && (
                  <Badge variant="secondary" className="mt-2 gap-1"><CheckCircle2 className="h-3 w-3" /> Connected</Badge>
                )}
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-accent/40">
              <Checkbox checked={enablePush} onCheckedChange={(v) => setEnablePush(!!v)} className="mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center gap-2 font-medium"><Bell className="h-4 w-4" /> Browser push</div>
                <p className="text-xs text-muted-foreground mt-1">Native notifications while Carbitrage is open in a tab.</p>
              </div>
            </label>
          </div>
        )}

        {step === "telegram" && (
          <div className="space-y-3 py-2">
            {telegramLinked ? (
              <div className="rounded-lg border p-4 bg-secondary/30 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <div className="text-sm">Telegram is linked. You'll get DMs for starred-car events.</div>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Tap the button below. It opens our bot — just hit <b>Start</b> there to finish linking.
                </p>
                <div className="flex gap-2">
                  <Button asChild className="flex-1">
                    <a href={deepLink} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4 mr-2" /> Open @{TELEGRAM_BOT_USERNAME}
                    </a>
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Or in Telegram, search <b>@{TELEGRAM_BOT_USERNAME}</b> and send:
                  <div className="mt-1 flex items-center gap-2">
                    <code className="rounded bg-muted px-2 py-1 text-foreground">/start {linkCode}</code>
                    <Button size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => { navigator.clipboard.writeText(`/start ${linkCode}`); toast.success("Copied"); }}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setStep("intro")}>← Back</Button>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button onClick={save} disabled={loading}>
            {loading ? "Saving…" : "Save & continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
