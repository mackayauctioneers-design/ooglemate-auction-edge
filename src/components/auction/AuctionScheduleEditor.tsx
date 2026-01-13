import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

type Props = {
  source_key: string;
  schedule_enabled: boolean;
  schedule_paused: boolean;
  schedule_days: string[] | null;
  schedule_time_local: string | null;
  schedule_min_interval_minutes: number | null;
  schedule_tz?: string | null;
  onSaved?: () => void;
};

function isValidHHMM(s: string) {
  const m = s.match(/^(\d{2}):(\d{2})$/);
  if (!m) return false;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

export function AuctionScheduleEditor(props: Props) {
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const [enabled, setEnabled] = useState(props.schedule_enabled);
  const [paused, setPaused] = useState(props.schedule_paused);
  const [timeLocal, setTimeLocal] = useState(props.schedule_time_local || "07:05");
  const [minInterval, setMinInterval] = useState<number>(props.schedule_min_interval_minutes ?? 60);
  const [days, setDays] = useState<string[]>(props.schedule_days?.length ? props.schedule_days : ["MON", "TUE", "WED", "THU", "FRI"]);

  const tz = props.schedule_tz || "Australia/Sydney";

  const dayBadges = useMemo(() => {
    const s = new Set(days);
    return DAYS.filter((d) => s.has(d)).map((d) => (
      <Badge key={d} variant="secondary" className="text-[10px]">
        {d}
      </Badge>
    ));
  }, [days]);

  async function save() {
    if (!isValidHHMM(timeLocal)) {
      toast.error("Time must be HH:MM (24h)");
      return;
    }
    if (days.length === 0) {
      toast.error("Pick at least one day");
      return;
    }
    if (!Number.isFinite(minInterval) || minInterval < 5) {
      toast.error("Min interval must be >= 5 minutes");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("auction_sources")
        .update({
          schedule_enabled: enabled,
          schedule_paused: paused,
          schedule_days: days,
          schedule_time_local: timeLocal,
          schedule_min_interval_minutes: minInterval,
          schedule_tz: tz,
        })
        .eq("source_key", props.source_key);

      if (error) throw error;
      toast.success("Schedule saved");
      setExpanded(false);
      props.onSaved?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      toast.error(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  function toggleDay(d: string) {
    setDays((prev) => {
      const s = new Set(prev);
      if (s.has(d)) s.delete(d);
      else s.add(d);
      return Array.from(s);
    });
  }

  if (!expanded) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => setExpanded(true)}>
          Edit Schedule
        </Button>
        {enabled && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            {timeLocal} {dayBadges}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Schedule Editor</div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{tz}</span>
          <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>
            Close
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(!!v)} />
          Enabled
        </label>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={paused} onCheckedChange={(v) => setPaused(!!v)} />
          Paused
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="text-xs text-muted-foreground mb-1">Time (local)</div>
          <Input value={timeLocal} onChange={(e) => setTimeLocal(e.target.value)} placeholder="07:05" />
          <div className="text-[11px] text-muted-foreground mt-1">Runs in a 5-minute window.</div>
        </div>

        <div>
          <div className="text-xs text-muted-foreground mb-1">Min interval (mins)</div>
          <Input
            type="number"
            value={minInterval}
            onChange={(e) => setMinInterval(parseInt(e.target.value || "0", 10))}
            min={5}
            step={5}
          />
          <div className="text-[11px] text-muted-foreground mt-1">Stops double-firing.</div>
        </div>

        <div>
          <div className="text-xs text-muted-foreground mb-1">Days</div>
          <div className="flex flex-wrap gap-1">
            {DAYS.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={days.includes(d) ? "default" : "outline"}
                onClick={() => toggleDay(d)}
                className="px-2 py-1 h-7 text-xs"
              >
                {d}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setExpanded(false)}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </div>
  );
}
