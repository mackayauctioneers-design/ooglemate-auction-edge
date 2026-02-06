import { useState, useRef } from "react";
import { DealArtefact, DealStatus, getAllowedArtefactTypes, uploadDealArtefact } from "@/hooks/useDeals";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileText, Camera, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

const ARTEFACT_LABELS: Record<string, string> = {
  listing_snapshot: "Listing Snapshot",
  auction_invoice: "Auction Invoice",
  tax_invoice: "Tax Invoice",
  buyer_fees_invoice: "Buyer Fees Invoice",
  payment_receipt: "Payment Receipt",
  transport_invoice: "Transport Invoice",
  arrival_photos: "Arrival Photos",
  condition_report: "Condition Report",
  other: "Other",
};

function ArtefactIcon({ type }: { type: string }) {
  if (type.includes("photo") || type === "listing_snapshot" || type === "condition_report") {
    return <Camera className="h-4 w-4" />;
  }
  return <FileText className="h-4 w-4" />;
}

interface Props {
  dealId: string;
  accountId: string;
  dealStatus: DealStatus;
  artefacts: DealArtefact[];
  onUploaded: () => void;
  createdBy: string;
}

export function DealArtefactsPanel({ dealId, accountId, dealStatus, artefacts, onUploaded, createdBy }: Props) {
  const [uploading, setUploading] = useState(false);
  const [selectedType, setSelectedType] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const allowedTypes = getAllowedArtefactTypes(dealStatus);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedType) return;

    setUploading(true);
    try {
      await uploadDealArtefact(dealId, accountId, selectedType, file, createdBy);
      toast.success(`${ARTEFACT_LABELS[selectedType] || selectedType} uploaded`);
      onUploaded();
      setSelectedType("");
    } catch (err) {
      console.error("Upload failed:", err);
      toast.error("Upload failed: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const getDownloadUrl = (fileUrl: string) => {
    const { data } = supabase.storage.from("deal-artefacts").getPublicUrl(fileUrl);
    return data?.publicUrl || "#";
  };

  // Group artefacts by type
  const grouped = artefacts.reduce<Record<string, DealArtefact[]>>((acc, a) => {
    if (!acc[a.artefact_type]) acc[a.artefact_type] = [];
    acc[a.artefact_type].push(a);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Documents & Artefacts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload section */}
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedType} onValueChange={setSelectedType}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Document type…" />
            </SelectTrigger>
            <SelectContent>
              {allowedTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {ARTEFACT_LABELS[t] || t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={handleUpload}
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
          />

          <Button
            size="sm"
            disabled={!selectedType || uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Upload className="h-4 w-4 mr-1" />
            )}
            Upload
          </Button>
        </div>

        {/* List artefacts */}
        {Object.keys(grouped).length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No documents uploaded yet.
          </p>
        ) : (
          <div className="space-y-3">
            {Object.entries(grouped).map(([type, items]) => (
              <div key={type}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  {ARTEFACT_LABELS[type] || type}
                </p>
                <div className="space-y-1">
                  {items.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 p-2 rounded-md bg-muted/30 text-sm"
                    >
                      <ArtefactIcon type={a.artefact_type} />
                      <span className="flex-1 truncate text-foreground">
                        {a.file_url.split("/").pop()}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {a.file_hash.slice(0, 8)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(a.created_at), "dd MMM HH:mm")}
                      </span>
                      <a
                        href={getDownloadUrl(a.file_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-primary/80"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          Documents are immutable and timestamped. SHA-256 hashes are recorded for audit integrity.
        </p>
      </CardContent>
    </Card>
  );
}
