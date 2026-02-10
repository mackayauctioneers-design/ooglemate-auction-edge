import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Camera, Upload, Loader2, CheckCircle2, X, ScanLine, Edit2, Eye, Bookmark, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { GuideOutput } from "./GuideOutput";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { useAccounts } from "@/hooks/useAccounts";

type Step = "upload" | "identifying" | "confirm" | "guiding" | "result";

interface ExtractedFields {
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  km: number | null;
  price: number | null;
  source: string | null;
}

interface GuideResult {
  salesTruth: Record<string, unknown>;
  supplyContext: Record<string, unknown>;
  guideSummary: Record<string, unknown>;
  confidence: "high" | "medium" | "low";
  identityConfidence: string;
  salesDepthConfidence: string;
  supplyCoverageConfidence: string;
}

export function ScanGuideFlow() {
  const { user } = useAuth();
  const { data: accounts } = useAccounts();
  const [accountSlug, setAccountSlug] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("upload");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageType, setImageType] = useState<"screenshot" | "photo">("screenshot");
  const [guideId, setGuideId] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedFields>({
    make: null, model: null, variant: null, year: null, km: null, price: null, source: null,
  });
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<GuideResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const selectedAccount = accounts?.find(a => a.slug === accountSlug);

  const handleFile = (file: File) => {
    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  const reset = () => {
    setStep("upload");
    clearImage();
    setGuideId(null);
    setExtracted({ make: null, model: null, variant: null, year: null, km: null, price: null, source: null });
    setEditing(false);
    setResult(null);
  };

  // Step A → B: Upload image, create guide record, call identify
  const startIdentify = async () => {
    if (!imageFile || !user || !selectedAccount) {
      toast.error(!selectedAccount ? "Select a dealer account first" : "Upload an image first");
      return;
    }

    setIsProcessing(true);
    setStep("identifying");

    try {
      // Create guide record
      const { data: guide, error: createErr } = await supabase
        .from("scan_guides")
        .insert({
          account_id: selectedAccount.id,
          user_id: user.id,
          image_type: imageType,
          status: "pending",
        })
        .select()
        .single();

      if (createErr) throw createErr;
      setGuideId(guide.id);

      // Upload image
      const ext = imageFile.name.split(".").pop() || "jpg";
      const path = `${user.id}/${guide.id}/scan.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("scan-guide-photos")
        .upload(path, imageFile);

      if (uploadErr) throw uploadErr;

      // Update path
      await supabase.from("scan_guides").update({ image_path: path }).eq("id", guide.id);

      // Call identify function
      const { data: identifyResult, error: identifyErr } = await supabase.functions.invoke(
        "screenshot-identify",
        { body: { guide_id: guide.id } }
      );

      if (identifyErr) throw identifyErr;

      const ext_ = identifyResult.extracted || {};
      setExtracted({
        make: ext_.make || null,
        model: ext_.model || null,
        variant: ext_.variant || null,
        year: ext_.year || null,
        km: ext_.km || null,
        price: ext_.price || null,
        source: ext_.source || null,
      });

      setStep("confirm");
    } catch (err) {
      console.error("Identify error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to identify");
      setStep("upload");
    } finally {
      setIsProcessing(false);
    }
  };

  // Step B → C: Confirm identity, generate guide
  const generateGuide = async () => {
    if (!guideId) return;

    setIsProcessing(true);
    setStep("guiding");

    try {
      const { data: guideResult, error: guideErr } = await supabase.functions.invoke(
        "screenshot-guide",
        {
          body: {
            guide_id: guideId,
            overrides: {
              make: extracted.make,
              model: extracted.model,
              variant: extracted.variant,
              year: extracted.year,
              km: extracted.km,
              price: extracted.price,
            },
          },
        }
      );

      if (guideErr) throw guideErr;

      setResult({
        salesTruth: guideResult.salesTruth,
        supplyContext: guideResult.supplyContext,
        guideSummary: guideResult.guideSummary,
        confidence: guideResult.confidence,
        identityConfidence: guideResult.identityConfidence,
        salesDepthConfidence: guideResult.salesDepthConfidence,
        supplyCoverageConfidence: guideResult.supplyCoverageConfidence,
      });

      setStep("result");
      toast.success("Guide generated");
    } catch (err) {
      console.error("Guide error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to generate guide");
      setStep("confirm");
    } finally {
      setIsProcessing(false);
    }
  };

  // Actions
  const addToWatchlist = () => {
    toast.info("Add to Watchlist — coming soon");
  };

  const sendToDave = () => {
    toast.info("Send to Dave — coming soon");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Account selector — always visible */}
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Dealer Account</Label>
        <AccountSelector value={accountSlug} onChange={setAccountSlug} />
      </div>

      {!selectedAccount && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            Select a dealer account to begin scanning.
          </CardContent>
        </Card>
      )}

      {selectedAccount && (
        <>
          {/* ── STEP A: Upload ── */}
          {step === "upload" && (
            <Card className={cn(
              "border-2 border-dashed transition-colors",
              imagePreview ? "border-primary" : "border-muted-foreground/25 hover:border-muted-foreground/50"
            )}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ScanLine className="h-5 w-5 text-primary" />
                  Upload Screenshot or Photo
                </CardTitle>
                <CardDescription className="text-xs">
                  Screenshot of a listing, or a photo of the car/plate
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Type selector */}
                <div className="flex gap-2">
                  <Button
                    variant={imageType === "screenshot" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setImageType("screenshot")}
                  >
                    Screenshot of listing
                  </Button>
                  <Button
                    variant={imageType === "photo" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setImageType("photo")}
                  >
                    Photo of car/plate
                  </Button>
                </div>

                {imagePreview ? (
                  <div className="relative">
                    <img
                      src={imagePreview}
                      alt="Uploaded"
                      className="w-full max-h-64 object-contain rounded-md bg-muted"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-2 right-2 h-8 w-8"
                      onClick={clearImage}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                    />
                    <Button
                      variant="outline"
                      className="flex-1 h-24 flex-col gap-2"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera className="h-6 w-6" />
                      <span className="text-xs">Take Photo</span>
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 h-24 flex-col gap-2"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-6 w-6" />
                      <span className="text-xs">Upload</span>
                    </Button>
                  </div>
                )}

                <Button
                  className="w-full"
                  disabled={!imageFile || isProcessing}
                  onClick={startIdentify}
                >
                  <ScanLine className="h-4 w-4 mr-2" />
                  Identify & Guide
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ── STEP B: Identifying ── */}
          {step === "identifying" && (
            <div className="py-12 flex flex-col items-center justify-center gap-4">
              <div className="relative">
                <div className="h-16 w-16 rounded-full border-4 border-primary/20 animate-pulse" />
                <Loader2 className="h-8 w-8 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin" />
              </div>
              <div className="text-center">
                <p className="font-medium">Extracting vehicle details...</p>
                <p className="text-sm text-muted-foreground">Analyzing your {imageType}</p>
              </div>
            </div>
          )}

          {/* ── STEP C: Confirm ── */}
          {step === "confirm" && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Eye className="h-5 w-5 text-primary" />
                    We detected:
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(!editing)}
                    className="text-xs"
                  >
                    <Edit2 className="h-3.5 w-3.5 mr-1" />
                    {editing ? "Done" : "Edit details"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Preview */}
                {imagePreview && (
                  <img
                    src={imagePreview}
                    alt="Scanned"
                    className="w-full max-h-40 object-contain rounded-md bg-muted"
                  />
                )}

                {/* Identity card */}
                {!editing ? (
                  <div className="bg-muted/50 rounded-md p-4 space-y-1">
                    <p className="font-semibold text-lg">
                      {[extracted.year, extracted.make, extracted.model, extracted.variant].filter(Boolean).join(" ") || "Unknown Vehicle"}
                    </p>
                    <div className="flex gap-3 text-sm text-muted-foreground flex-wrap">
                      {extracted.km && <span>{extracted.km.toLocaleString()} km</span>}
                      {extracted.price && <span>${extracted.price.toLocaleString()}</span>}
                      {extracted.source && <span>via {extracted.source}</span>}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Make</Label>
                      <Input
                        value={extracted.make || ""}
                        onChange={e => setExtracted(p => ({ ...p, make: e.target.value || null }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Model</Label>
                      <Input
                        value={extracted.model || ""}
                        onChange={e => setExtracted(p => ({ ...p, model: e.target.value || null }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Variant</Label>
                      <Input
                        value={extracted.variant || ""}
                        onChange={e => setExtracted(p => ({ ...p, variant: e.target.value || null }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Year</Label>
                      <Input
                        type="number"
                        value={extracted.year || ""}
                        onChange={e => setExtracted(p => ({ ...p, year: e.target.value ? parseInt(e.target.value) : null }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">KM</Label>
                      <Input
                        type="number"
                        value={extracted.km || ""}
                        onChange={e => setExtracted(p => ({ ...p, km: e.target.value ? parseInt(e.target.value) : null }))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Price ($)</Label>
                      <Input
                        type="number"
                        value={extracted.price || ""}
                        onChange={e => setExtracted(p => ({ ...p, price: e.target.value ? parseInt(e.target.value) : null }))}
                      />
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button className="flex-1" onClick={generateGuide} disabled={isProcessing}>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Looks right — Generate Guide
                  </Button>
                </div>
                <Button variant="ghost" size="sm" className="w-full" onClick={reset}>
                  Start over
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ── STEP D: Generating Guide ── */}
          {step === "guiding" && (
            <div className="py-12 flex flex-col items-center justify-center gap-4">
              <div className="relative">
                <div className="h-16 w-16 rounded-full border-4 border-primary/20 animate-pulse" />
                <Loader2 className="h-8 w-8 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin" />
              </div>
              <div className="text-center">
                <p className="font-medium">Generating Carbitrage Guide...</p>
                <p className="text-sm text-muted-foreground">Checking your sales truth + live supply</p>
              </div>
            </div>
          )}

          {/* ── STEP E: Result ── */}
          {step === "result" && result && (
            <div className="space-y-4">
              {/* Identity recap */}
              <div className="bg-muted/50 rounded-md p-3">
                <p className="font-semibold">
                  {[extracted.year, extracted.make, extracted.model, extracted.variant].filter(Boolean).join(" ")}
                </p>
                <div className="flex gap-3 text-sm text-muted-foreground">
                  {extracted.km && <span>{extracted.km.toLocaleString()} km</span>}
                  {extracted.price && <span>${extracted.price.toLocaleString()}</span>}
                </div>
              </div>

              <GuideOutput
                salesTruth={result.salesTruth as any}
                supplyContext={result.supplyContext as any}
                guideSummary={result.guideSummary as any}
                confidence={result.confidence}
                identityConfidence={result.identityConfidence}
                salesDepthConfidence={result.salesDepthConfidence}
                supplyCoverageConfidence={result.supplyCoverageConfidence}
              />

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={addToWatchlist}>
                  <Bookmark className="h-4 w-4 mr-2" />
                  Add to Watchlist
                </Button>
                <Button variant="outline" className="flex-1" onClick={sendToDave}>
                  <Send className="h-4 w-4 mr-2" />
                  Send to Dave
                </Button>
              </div>

              <Button variant="ghost" className="w-full" onClick={reset}>
                Scan Another
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
