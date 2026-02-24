import { useState } from "react";
import { useCreateOogleBotJob } from "@/hooks/useOogleBot";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Bot, ChevronDown } from "lucide-react";

export function OogleBotJobForm() {
  const { user } = useAuth();
  const createJob = useCreateOogleBotJob();
  const [open, setOpen] = useState(false);

  const [form, setForm] = useState({
    dealer_name: "",
    dealer_contact: "",
    make: "",
    model: "",
    variant: "",
    year_min: "",
    year_max: "",
    km_max: "",
    budget_ceiling: "",
    urgency: "normal" as "normal" | "high" | "urgent",
    notes: "",
  });

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    createJob.mutate(
      {
        dealer_name: form.dealer_name,
        dealer_contact: form.dealer_contact || null,
        make: form.make.toUpperCase(),
        model: form.model.toUpperCase(),
        variant: form.variant || null,
        year_min: Number(form.year_min),
        year_max: Number(form.year_max),
        km_max: Number(form.km_max),
        budget_ceiling: Number(form.budget_ceiling),
        urgency: form.urgency,
        notes: form.notes || null,
        created_by: user.id,
      },
      {
        onSuccess: () => {
          setForm({
            dealer_name: "",
            dealer_contact: "",
            make: "",
            model: "",
            variant: "",
            year_min: "",
            year_max: "",
            km_max: "",
            budget_ceiling: "",
            urgency: "normal",
            notes: "",
          });
          setOpen(false);
        },
      }
    );
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border bg-card">
        <CollapsibleTrigger asChild>
          <button className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <span className="font-semibold text-foreground">Create OogleBot Job</span>
            </div>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <form onSubmit={handleSubmit} className="p-4 pt-0 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Dealer Name *</Label>
                <Input value={form.dealer_name} onChange={(e) => set("dealer_name", e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>Dealer Contact</Label>
                <Input value={form.dealer_contact} onChange={(e) => set("dealer_contact", e.target.value)} placeholder="Phone / email" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Make *</Label>
                <Input value={form.make} onChange={(e) => set("make", e.target.value)} required placeholder="TOYOTA" />
              </div>
              <div className="space-y-1.5">
                <Label>Model *</Label>
                <Input value={form.model} onChange={(e) => set("model", e.target.value)} required placeholder="HILUX" />
              </div>
              <div className="space-y-1.5">
                <Label>Variant</Label>
                <Input value={form.variant} onChange={(e) => set("variant", e.target.value)} placeholder="SR5" />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label>Year Min *</Label>
                <Input type="number" value={form.year_min} onChange={(e) => set("year_min", e.target.value)} required placeholder="2018" />
              </div>
              <div className="space-y-1.5">
                <Label>Year Max *</Label>
                <Input type="number" value={form.year_max} onChange={(e) => set("year_max", e.target.value)} required placeholder="2023" />
              </div>
              <div className="space-y-1.5">
                <Label>KM Max *</Label>
                <Input type="number" value={form.km_max} onChange={(e) => set("km_max", e.target.value)} required placeholder="120000" />
              </div>
              <div className="space-y-1.5">
                <Label>Budget Ceiling *</Label>
                <Input type="number" value={form.budget_ceiling} onChange={(e) => set("budget_ceiling", e.target.value)} required placeholder="45000" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Urgency</Label>
                <Select value={form.urgency} onValueChange={(v) => set("urgency", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder="Special instructions..." />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={createJob.isPending}>
              <Bot className="h-4 w-4 mr-1" />
              {createJob.isPending ? "Creating..." : "Start OogleBot"}
            </Button>
          </form>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
