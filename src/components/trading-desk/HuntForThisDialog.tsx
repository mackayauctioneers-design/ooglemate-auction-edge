import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";

interface Props {
  accountId: string;
  variant?: "default" | "outline";
  label?: string;
}

/**
 * Dealer-facing CTA that lodges a sourcing mandate scoped to this dealer's account.
 * The existing run-mandates cron + CaroogleAI/Arby loop will pick it up on its next pass
 * and surface finds back into the Trading Desk via the normal matching pipeline.
 */
export function HuntForThisDialog({ accountId, variant = "default", label = "Hunt for this" }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    make: "",
    model: "",
    year_min: "",
    year_max: "",
    km_max: "",
    price_max: "",
  });

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.make.trim() || !form.model.trim()) {
      toast.error("Make and model are required");
      return;
    }
    setBusy(true);
    try {
      const make = form.make.trim().toUpperCase();
      const model = form.model.trim().toUpperCase();
      const { error } = await supabase.from("active_mandates").insert({
        account_id: accountId,
        name: `${make} ${model} (dealer hunt)`,
        make,
        model,
        year_min: form.year_min ? parseInt(form.year_min) : null,
        year_max: form.year_max ? parseInt(form.year_max) : null,
        km_max: form.km_max ? parseInt(form.km_max) : null,
        price_max: form.price_max ? parseInt(form.price_max) : null,
        priority: "high",
        run_frequency_minutes: 240,
        source_mask: ["pickles", "toyota", "carsales"],
        next_run_at: new Date().toISOString(),
        is_active: true,
      });
      if (error) throw error;
      toast.success("Hunt lodged — Arby will scan and surface matches in your Trading Desk.");
      setOpen(false);
      setForm({ make: "", model: "", year_min: "", year_max: "", km_max: "", price_max: "" });
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm">
          <Search className="h-4 w-4 mr-1" /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Hunt for a vehicle</DialogTitle>
          <DialogDescription>
            Tell Arby what you're chasing. We'll scan auctions, dealer sites and retail for matches
            and surface them in your Trading Desk automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Make *</Label>
              <Input placeholder="TOYOTA" value={form.make} onChange={update("make")} />
            </div>
            <div>
              <Label>Model *</Label>
              <Input placeholder="HILUX" value={form.model} onChange={update("model")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Year min</Label>
              <Input type="number" placeholder="2018" value={form.year_min} onChange={update("year_min")} />
            </div>
            <div>
              <Label>Year max</Label>
              <Input type="number" placeholder="2024" value={form.year_max} onChange={update("year_max")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Max KM</Label>
              <Input type="number" placeholder="150000" value={form.km_max} onChange={update("km_max")} />
            </div>
            <div>
              <Label>Max price ($)</Label>
              <Input type="number" placeholder="55000" value={form.price_max} onChange={update("price_max")} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Search className="h-4 w-4 mr-1" />}
            Lodge hunt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
