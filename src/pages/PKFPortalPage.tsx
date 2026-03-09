import { useState } from "react";
import { OogleBotSearch } from "@/components/ooglebot/OogleBotSearch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Search, Send, LogOut, Car, Clock, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import pkfLogo from "@/assets/pkf-logo.jpg";

export default function PKFPortalPage() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"search" | "request">("search");
  const [requestForm, setRequestForm] = useState({
    make: "",
    model: "",
    year_range: "",
    max_km: "",
    max_budget: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitRequest = async () => {
    if (!requestForm.make || !requestForm.model) {
      toast({
        title: "Missing fields",
        description: "Make and Model are required.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      // Insert as a dealer_demand entry linked to the partner
      const { error } = await supabase.from("dealer_demands").insert({
        dealer_name: "PKF Partner",
        make: requestForm.make.trim(),
        model: requestForm.model.trim(),
        year_min: requestForm.year_range ? parseInt(requestForm.year_range.split("-")[0]) : null,
        year_max: requestForm.year_range ? parseInt(requestForm.year_range.split("-")[1] || requestForm.year_range.split("-")[0]) : null,
        km_max: requestForm.max_km ? parseInt(requestForm.max_km.replace(/\D/g, "")) : null,
        price_max: requestForm.max_budget ? parseInt(requestForm.max_budget.replace(/\D/g, "")) : null,
        notes: requestForm.notes || null,
        status: "active",
        urgency: "normal",
        buyer_name: user?.email || "PKF Partner",
      });

      if (error) throw error;

      toast({
        title: "Request submitted",
        description: "We'll notify you when we find matching vehicles.",
      });
      setRequestForm({ make: "", model: "", year_range: "", max_km: "", max_budget: "", notes: "" });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to submit request",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src={pkfLogo} alt="PKF" className="h-8 object-contain" />
            <div className="h-6 w-px bg-border" />
            <div>
              <h1 className="text-lg font-semibold text-foreground tracking-tight">
                PKF Portal
              </h1>
              <p className="text-xs text-muted-foreground">
                Vehicle sourcing powered by Carbotrage
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <span className="text-xs text-muted-foreground hidden sm:block">
                {user.email}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Tab nav */}
      <div className="max-w-5xl mx-auto px-6 pt-6">
        <div className="flex gap-1 bg-secondary rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab("search")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "search"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Search className="h-4 w-4" />
            Search Market
          </button>
          <button
            onClick={() => setActiveTab("request")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "request"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Send className="h-4 w-4" />
            Submit Request
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-6">
        {activeTab === "search" ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Car className="h-4 w-4" />
              <span>Search across auctions, dealers, and retail classifieds</span>
            </div>
            <OogleBotSearch />
          </div>
        ) : (
          <div className="max-w-lg space-y-6">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">Submit a Vehicle Request</h2>
              <p className="text-sm text-muted-foreground">
                Tell us what you're looking for and we'll find it for you.
              </p>
            </div>

            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="make">Make *</Label>
                    <Input
                      id="make"
                      placeholder="e.g. Toyota"
                      value={requestForm.make}
                      onChange={(e) => setRequestForm((f) => ({ ...f, make: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model">Model *</Label>
                    <Input
                      id="model"
                      placeholder="e.g. HiLux"
                      value={requestForm.model}
                      onChange={(e) => setRequestForm((f) => ({ ...f, model: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="year_range">Year Range</Label>
                    <Input
                      id="year_range"
                      placeholder="e.g. 2019-2023"
                      value={requestForm.year_range}
                      onChange={(e) => setRequestForm((f) => ({ ...f, year_range: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max_km">Max KM</Label>
                    <Input
                      id="max_km"
                      placeholder="e.g. 80000"
                      value={requestForm.max_km}
                      onChange={(e) => setRequestForm((f) => ({ ...f, max_km: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max_budget">Max Budget</Label>
                    <Input
                      id="max_budget"
                      placeholder="e.g. 55000"
                      value={requestForm.max_budget}
                      onChange={(e) => setRequestForm((f) => ({ ...f, max_budget: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    placeholder="Any specific requirements — colour, variant, features, urgency..."
                    value={requestForm.notes}
                    onChange={(e) => setRequestForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={3}
                  />
                </div>

                <Button
                  onClick={handleSubmitRequest}
                  disabled={submitting || !requestForm.make || !requestForm.model}
                  className="w-full"
                >
                  {submitting ? (
                    <>Submitting...</>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Submit Request
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-secondary text-sm">
              <CheckCircle2 className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium text-foreground">What happens next?</p>
                <p className="text-muted-foreground">
                  Your request is added to our active demand desk. We continuously scan
                  auctions, dealer inventory, and classifieds — you'll be notified when
                  a match is found.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer CTA */}
      <div className="max-w-5xl mx-auto px-6 pb-8">
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          onClick={() => {
            toast({
              title: "Valuation requested",
              description: "Your request has been sent. We'll be in touch shortly.",
            });
          }}
        >
          <Car className="h-4 w-4 mr-2" />
          Send for Official Valuation
        </Button>
      </div>
    </div>
  );
}
