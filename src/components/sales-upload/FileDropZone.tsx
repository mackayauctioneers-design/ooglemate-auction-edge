import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

interface FileDropZoneProps {
  onFileSelected: (file: File) => void;
  isProcessing: boolean;
}

export function FileDropZone({ onFileSelected, isProcessing }: FileDropZoneProps) {
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files?.[0]) {
        onFileSelected(e.dataTransfer.files[0]);
      }
    },
    [onFileSelected]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      onFileSelected(e.target.files[0]);
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
          CSV or spreadsheet — any format, any headers
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          We'll map your columns automatically
        </p>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFileInput}
          className="hidden"
          id="file-upload"
        />
        <Button asChild disabled={isProcessing}>
          <label htmlFor="file-upload" className="cursor-pointer">
            {isProcessing ? "Processing..." : "Select File"}
          </label>
        </Button>
      </CardContent>
    </Card>
  );
}
