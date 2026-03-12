import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileSpreadsheet, FileText, CheckCircle2, Merge, Loader2 } from "lucide-react";

interface DualFileUploadProps {
  onFilesReady: (soldFile: File, acqFile: File) => void;
  isProcessing: boolean;
}

const ACCEPTED_TYPES = ".csv,.xlsx,.xls,.pdf";

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return <FileText className="h-4 w-4" />;
  return <FileSpreadsheet className="h-4 w-4" />;
}

interface SlotProps {
  label: string;
  sublabel: string;
  file: File | null;
  inputId: string;
  onFile: (f: File) => void;
  disabled: boolean;
}

function FileSlot({ label, sublabel, file, inputId, onFile, disabled }: SlotProps) {
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) onFile(e.dataTransfer.files[0]);
  }, [onFile]);

  return (
    <div
      className={`relative rounded-lg border-2 border-dashed p-6 flex flex-col items-center text-center transition-colors ${
        file ? "border-primary/50 bg-primary/5" : dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"
      }`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      {file ? (
        <>
          <CheckCircle2 className="h-8 w-8 text-primary mb-2" />
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {getFileIcon(file.name)}
            <span className="truncate max-w-[200px]">{file.name}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {(file.size / 1024).toFixed(0)} KB
          </p>
        </>
      ) : (
        <>
          <Upload className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>
          <input
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            className="hidden"
            id={inputId}
            disabled={disabled}
          />
          <Button asChild size="sm" variant="outline" className="mt-3" disabled={disabled}>
            <label htmlFor={inputId} className="cursor-pointer">Select File</label>
          </Button>
        </>
      )}
    </div>
  );
}

export function DualFileUpload({ onFilesReady, isProcessing }: DualFileUploadProps) {
  const [soldFile, setSoldFile] = useState<File | null>(null);
  const [acqFile, setAcqFile] = useState<File | null>(null);

  const bothReady = soldFile && acqFile;

  return (
    <Card className="border-2 border-dashed border-muted-foreground/25">
      <CardContent className="py-8 space-y-6">
        <div className="text-center">
          <Merge className="h-10 w-10 text-primary mx-auto mb-2" />
          <h3 className="text-lg font-medium">EasyCars Report Merge</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Upload both reports — we'll merge KMs, buy price, and VIN into your sales data
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Badge variant="outline" className="mb-2">1. Sold Stock Report</Badge>
            <FileSlot
              label="Drop Sold Stock Report"
              sublabel="The EasyCars profit report with sale prices"
              file={soldFile}
              inputId="sold-file"
              onFile={setSoldFile}
              disabled={isProcessing}
            />
          </div>
          <div>
            <Badge variant="outline" className="mb-2">2. Acquisition / Stock List</Badge>
            <FileSlot
              label="Drop Acquisition Report"
              sublabel="The EasyCars stock list with KMs and buy prices"
              file={acqFile}
              inputId="acq-file"
              onFile={setAcqFile}
              disabled={isProcessing}
            />
          </div>
        </div>

        {bothReady && (
          <div className="flex justify-center">
            <Button
              onClick={() => onFilesReady(soldFile!, acqFile!)}
              disabled={isProcessing}
              size="lg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Merging reports…
                </>
              ) : (
                <>
                  <Merge className="h-4 w-4 mr-2" />
                  Merge &amp; Import
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
