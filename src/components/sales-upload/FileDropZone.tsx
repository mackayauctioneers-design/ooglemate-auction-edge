import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, FileText } from "lucide-react";

interface FileDropZoneProps {
  onFileSelected: (file: File) => void;
  isProcessing: boolean;
}

const ACCEPTED_TYPES = ".csv,.xlsx,.xls,.pdf,.tsv,.txt";

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return <FileText className="h-5 w-5" />;
  if (ext === "xlsx" || ext === "xls") return <FileSpreadsheet className="h-5 w-5" />;
  return <FileSpreadsheet className="h-5 w-5" />;
}

export function FileDropZone({ onFileSelected, isProcessing }: FileDropZoneProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      setSelectedName(file.name);
      onFileSelected(file);
    },
    [onFileSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files?.[0]) {
        handleFile(e.dataTransfer.files[0]);
      }
    },
    [handleFile]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      handleFile(e.target.files[0]);
    }
  };

  return (
    <Card
      className={`border-2 border-dashed transition-colors ${
        dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"
      }`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <CardContent className="py-12 flex flex-col items-center justify-center text-center">
        <Upload className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium">Drop any sales file here</h3>
        <p className="text-sm text-muted-foreground mt-1 mb-1">
          CSV, Excel, PDF — any format, any headers
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          We'll interpret your columns automatically — never rejected
        </p>

        {selectedName && isProcessing && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
            {getFileIcon(selectedName)}
            <span>{selectedName}</span>
            <span className="animate-pulse">— interpreting…</span>
          </div>
        )}

        <input
          type="file"
          accept={ACCEPTED_TYPES}
          onChange={handleFileInput}
          className="hidden"
          id="file-upload"
        />
        <Button asChild disabled={isProcessing}>
          <label htmlFor="file-upload" className="cursor-pointer">
            {isProcessing ? "Interpreting file…" : "Select File"}
          </label>
        </Button>
      </CardContent>
    </Card>
  );
}
