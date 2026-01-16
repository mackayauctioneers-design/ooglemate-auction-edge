import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, Share2, Copy, Check } from "lucide-react";
import { ProofOfHuntArtifact } from "./ProofOfHuntArtifact";
import type { SaleHunt, HuntAlert, HuntScan } from "@/types/hunts";

interface ProofOfHuntModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hunt: SaleHunt;
  strikeAlert: HuntAlert;
  scans: HuntScan[];
}

export function ProofOfHuntModal({
  open,
  onOpenChange,
  hunt,
  strikeAlert,
  scans
}: ProofOfHuntModalProps) {
  const [copied, setCopied] = useState(false);
  const artifactRef = useRef<HTMLDivElement>(null);

  const handleShare = async () => {
    const shareData = {
      title: `Kiting Mode Strike: ${hunt.year} ${hunt.make} ${hunt.model}`,
      text: `Found a ${hunt.year} ${hunt.make} ${hunt.model} using Carbitrage Kiting Mode™`,
      url: window.location.href
    };

    if (navigator.share && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        toast.success("Shared successfully");
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error("Share failed:", err);
        }
      }
    } else {
      handleCopyLink();
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    toast.success("Link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = async () => {
    // For now, just create a text summary
    // In production, could use html2canvas for image export
    const summary = `
KITING MODE™ STRIKE PROOF
========================

SALE FINGERPRINT
${hunt.year} ${hunt.make} ${hunt.model}
${hunt.variant_family || ''}
Proven Exit: $${hunt.proven_exit_value?.toLocaleString() || 'N/A'}

HUNT STATS
Started: ${new Date(hunt.created_at).toLocaleDateString()}
Strike: ${new Date(strikeAlert.created_at).toLocaleDateString()}
Scans: ${scans.length}

STRIKE DETAILS
Source: ${(strikeAlert.payload as any)?.source || 'Unknown'}
Location: ${(strikeAlert.payload as any)?.state || 'Unknown'}

MARGIN CAPTURED
Gap: $${(strikeAlert.payload as any)?.gap_dollars?.toLocaleString() || 'N/A'}
Percent: ${(strikeAlert.payload as any)?.gap_pct?.toFixed(1) || 'N/A'}%

---
Powered by Carbitrage™ Kiting Mode
    `.trim();

    const blob = new Blob([summary], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `strike-proof-${hunt.make}-${hunt.model}-${hunt.year}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success("Proof exported");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Proof of Hunt</DialogTitle>
          <DialogDescription>
            Share this artifact to demonstrate Kiting Mode success
          </DialogDescription>
        </DialogHeader>

        <div ref={artifactRef}>
          <ProofOfHuntArtifact
            hunt={hunt}
            strikeAlert={strikeAlert}
            scans={scans}
            onShare={handleShare}
            onExport={handleExport}
          />
        </div>

        <div className="flex gap-2 mt-4">
          <Button variant="outline" className="flex-1" onClick={handleCopyLink}>
            {copied ? (
              <>
                <Check className="h-4 w-4 mr-2" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                Copy Link
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
