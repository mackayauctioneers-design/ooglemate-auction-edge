import { AppLayout } from "@/components/layout/AppLayout";
import { ScanGuideFlow } from "@/components/scan-guide/ScanGuideFlow";
import { ScanLine } from "lucide-react";

export default function ScanGuidePage() {
  // Page title set via document
  document.title = "Scan Screenshot — Carbitrage";

  return (
    <AppLayout>
      <div className="p-4 md:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ScanLine className="h-6 w-6 text-primary" />
            Scan Screenshot
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload a screenshot or photo → identify → get your truth-based guide
          </p>
        </div>
        <ScanGuideFlow />
      </div>
    </AppLayout>
  );
}
