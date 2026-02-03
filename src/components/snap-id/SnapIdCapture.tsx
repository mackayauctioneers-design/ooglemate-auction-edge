import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Camera, Upload, Loader2, CheckCircle2, X, ScanLine } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { VehicleIntelligenceCard } from "./VehicleIntelligenceCard";
import { cn } from "@/lib/utils";

interface SnapIdResult {
  sessionId: string;
  make: string | null;
  model: string | null;
  yearMin: number | null;
  yearMax: number | null;
  variant: string | null;
  transmission: string | null;
  fuelType: string | null;
  bodyType: string | null;
  confidence: "high" | "medium" | "low";
  knownIssues: string[];
  avoidedIssues: string[];
  whyThisMatters: string;
  vin: string | null;
}

interface SnapIdCaptureProps {
  onResult?: (result: SnapIdResult) => void;
  className?: string;
  triggerClassName?: string;
  variant?: "button" | "fab";
}

export function SnapIdCapture({ onResult, className, triggerClassName, variant = "button" }: SnapIdCaptureProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"capture" | "processing" | "result">("capture");
  const [complianceImage, setComplianceImage] = useState<File | null>(null);
  const [compliancePreview, setCompliancePreview] = useState<string | null>(null);
  const [windscreenImage, setWindscreenImage] = useState<File | null>(null);
  const [windscreenPreview, setWindscreenPreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<SnapIdResult | null>(null);

  const complianceInputRef = useRef<HTMLInputElement>(null);
  const windscreenInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File, type: "compliance" | "windscreen") => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (type === "compliance") {
        setComplianceImage(file);
        setCompliancePreview(reader.result as string);
      } else {
        setWindscreenImage(file);
        setWindscreenPreview(reader.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>, type: "compliance" | "windscreen") => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file, type);
    }
  };

  const clearImage = (type: "compliance" | "windscreen") => {
    if (type === "compliance") {
      setComplianceImage(null);
      setCompliancePreview(null);
      if (complianceInputRef.current) complianceInputRef.current.value = "";
    } else {
      setWindscreenImage(null);
      setWindscreenPreview(null);
      if (windscreenInputRef.current) windscreenInputRef.current.value = "";
    }
  };

  const processImages = async () => {
    if (!complianceImage) {
      toast.error("Compliance plate photo is required");
      return;
    }

    if (!user) {
      toast.error("Please sign in to use Snap-ID");
      return;
    }

    setIsProcessing(true);
    setStep("processing");

    try {
      // 1. Create session
      const { data: session, error: sessionErr } = await supabase
        .from("snap_id_sessions")
        .insert({
          user_id: user.id,
          status: "pending",
        })
        .select()
        .single();

      if (sessionErr) throw sessionErr;

      // 2. Upload compliance plate image
      const compliancePath = `${user.id}/${session.id}/compliance.${complianceImage.name.split('.').pop()}`;
      const { error: uploadErr } = await supabase.storage
        .from("snap-id-photos")
        .upload(compliancePath, complianceImage);

      if (uploadErr) throw uploadErr;

      // Update session with path
      await supabase
        .from("snap_id_sessions")
        .update({ compliance_plate_path: compliancePath })
        .eq("id", session.id);

      // 3. Upload windscreen image if provided
      if (windscreenImage) {
        const windscreenPath = `${user.id}/${session.id}/windscreen.${windscreenImage.name.split('.').pop()}`;
        const { error: windscreenErr } = await supabase.storage
          .from("snap-id-photos")
          .upload(windscreenPath, windscreenImage);

        if (!windscreenErr) {
          await supabase
            .from("snap_id_sessions")
            .update({ windscreen_vin_path: windscreenPath })
            .eq("id", session.id);
        }
      }

      // 4. Invoke processing function
      const { data: processResult, error: processErr } = await supabase.functions.invoke(
        "snap-id-process",
        { body: { session_id: session.id } }
      );

      if (processErr) throw processErr;

      // 5. Fetch completed session
      const { data: completedSession, error: fetchErr } = await supabase
        .from("snap_id_sessions")
        .select("*")
        .eq("id", session.id)
        .single();

      if (fetchErr) throw fetchErr;

      if (completedSession.status === "failed") {
        throw new Error(completedSession.error || "Processing failed");
      }

      const snapResult: SnapIdResult = {
        sessionId: completedSession.id,
        make: completedSession.identified_make,
        model: completedSession.identified_model,
        yearMin: completedSession.identified_year_min,
        yearMax: completedSession.identified_year_max,
        variant: completedSession.identified_variant,
        transmission: completedSession.identified_transmission,
        fuelType: completedSession.identified_fuel_type,
        bodyType: completedSession.identified_body_type,
        confidence: completedSession.vehicle_confidence as "high" | "medium" | "low",
        knownIssues: (completedSession.known_issues as string[]) || [],
        avoidedIssues: (completedSession.avoided_issues as string[]) || [],
        whyThisMatters: completedSession.why_this_matters || "",
        vin: completedSession.extracted_vin,
      };

      setResult(snapResult);
      setStep("result");
      toast.success("Vehicle identified!");

      if (onResult) {
        onResult(snapResult);
      }

    } catch (err) {
      console.error("Snap-ID error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to process image");
      setStep("capture");
    } finally {
      setIsProcessing(false);
    }
  };

  const reset = () => {
    setStep("capture");
    setComplianceImage(null);
    setCompliancePreview(null);
    setWindscreenImage(null);
    setWindscreenPreview(null);
    setResult(null);
  };

  const handleClose = () => {
    setOpen(false);
    // Don't reset immediately so user can see result
    setTimeout(reset, 300);
  };

  const TriggerButton = variant === "fab" ? (
    <Button
      size="icon"
      className={cn(
        "fixed bottom-20 right-4 h-14 w-14 rounded-full shadow-lg z-50 md:hidden",
        triggerClassName
      )}
    >
      <ScanLine className="h-6 w-6" />
    </Button>
  ) : (
    <Button variant="outline" className={cn("gap-2", triggerClassName)}>
      <ScanLine className="h-4 w-4" />
      Snap-ID
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {TriggerButton}
      </DialogTrigger>
      <DialogContent className={cn("max-w-lg max-h-[90vh] overflow-y-auto", className)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            Snap-ID
          </DialogTitle>
          <DialogDescription>
            Take photos of the VIN plate to instantly identify the vehicle
          </DialogDescription>
        </DialogHeader>

        {step === "capture" && (
          <div className="space-y-4 py-4">
            {/* Compliance Plate (Required) */}
            <Card className={cn(
              "border-2 border-dashed transition-colors",
              compliancePreview ? "border-primary" : "border-muted-foreground/25 hover:border-muted-foreground/50"
            )}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  Compliance/VIN Plate
                  <span className="text-destructive">*</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Usually on the door jamb or under the bonnet
                </CardDescription>
              </CardHeader>
              <CardContent>
                {compliancePreview ? (
                  <div className="relative">
                    <img
                      src={compliancePreview}
                      alt="Compliance plate"
                      className="w-full h-40 object-cover rounded-md"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-2 right-2 h-8 w-8"
                      onClick={() => clearImage("compliance")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      ref={complianceInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => handleInputChange(e, "compliance")}
                    />
                    <Button
                      variant="outline"
                      className="flex-1 h-24 flex-col gap-2"
                      onClick={() => complianceInputRef.current?.click()}
                    >
                      <Camera className="h-6 w-6" />
                      <span className="text-xs">Take Photo</span>
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 h-24 flex-col gap-2"
                      onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = "image/*";
                        input.onchange = (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) handleFileSelect(file, "compliance");
                        };
                        input.click();
                      }}
                    >
                      <Upload className="h-6 w-6" />
                      <span className="text-xs">Upload</span>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Windscreen VIN (Optional) */}
            <Card className={cn(
              "border-2 border-dashed transition-colors",
              windscreenPreview ? "border-primary" : "border-muted-foreground/25 hover:border-muted-foreground/50"
            )}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  Windscreen VIN
                  <span className="text-muted-foreground text-xs">(recommended)</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Bottom corner of the windscreen - helps verify VIN
                </CardDescription>
              </CardHeader>
              <CardContent>
                {windscreenPreview ? (
                  <div className="relative">
                    <img
                      src={windscreenPreview}
                      alt="Windscreen VIN"
                      className="w-full h-32 object-cover rounded-md"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute top-2 right-2 h-8 w-8"
                      onClick={() => clearImage("windscreen")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      ref={windscreenInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => handleInputChange(e, "windscreen")}
                    />
                    <Button
                      variant="outline"
                      className="flex-1 h-20 flex-col gap-2"
                      onClick={() => windscreenInputRef.current?.click()}
                    >
                      <Camera className="h-5 w-5" />
                      <span className="text-xs">Take Photo</span>
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 h-20 flex-col gap-2"
                      onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = "image/*";
                        input.onchange = (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) handleFileSelect(file, "windscreen");
                        };
                        input.click();
                      }}
                    >
                      <Upload className="h-5 w-5" />
                      <span className="text-xs">Upload</span>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Button
              className="w-full"
              disabled={!complianceImage || isProcessing}
              onClick={processImages}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Processing...
                </>
              ) : (
                <>
                  <ScanLine className="h-4 w-4 mr-2" />
                  Identify Vehicle
                </>
              )}
            </Button>
          </div>
        )}

        {step === "processing" && (
          <div className="py-12 flex flex-col items-center justify-center gap-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-full border-4 border-primary/20 animate-pulse" />
              <Loader2 className="h-8 w-8 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin" />
            </div>
            <div className="text-center">
              <p className="font-medium">Analyzing VIN plate...</p>
              <p className="text-sm text-muted-foreground">This may take a few seconds</p>
            </div>
          </div>
        )}

        {step === "result" && result && (
          <div className="py-4 space-y-4">
            <div className="flex items-center gap-2 text-green-600 mb-4">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">Vehicle Identified</span>
            </div>

            <VehicleIntelligenceCard
              make={result.make}
              model={result.model}
              yearMin={result.yearMin}
              yearMax={result.yearMax}
              variant={result.variant}
              transmission={result.transmission}
              fuelType={result.fuelType}
              bodyType={result.bodyType}
              confidence={result.confidence}
              knownIssues={result.knownIssues}
              avoidedIssues={result.avoidedIssues}
              whyThisMatters={result.whyThisMatters}
              vin={result.vin}
            />

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={reset}>
                Scan Another
              </Button>
              <Button className="flex-1" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
