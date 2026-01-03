import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Camera, Upload, X, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ValoResult, ValoParsedVehicle } from '@/types';

interface SendPicsToFrankProps {
  result: ValoResult;
  parsed: ValoParsedVehicle;
  frankResponse: string;
  dealerName: string;
  onSubmitted: (requestId: string) => void;
}

const PHOTO_GUIDES = [
  { id: 'front', label: 'Front 3/4', description: 'Front corner angle showing bonnet and side', required: true },
  { id: 'rear', label: 'Rear 3/4', description: 'Rear corner angle showing boot and side', required: true },
  { id: 'interior', label: 'Interior Dash', description: 'Dashboard and steering wheel', required: true },
  { id: 'engine', label: 'Engine Bay', description: 'Engine compartment', required: true },
  { id: 'compliance', label: 'Compliance Plate', description: 'Build/compliance plate (optional)', required: false },
];

export function SendPicsToFrank({ result, parsed, frankResponse, dealerName, onSubmitted }: SendPicsToFrankProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [photos, setPhotos] = useState<Record<string, File | null>>({});
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const vehicleSummary = [
    parsed.year,
    parsed.make,
    parsed.model,
    parsed.variant_family
  ].filter(Boolean).join(' ');

  const handlePhotoSelect = (photoId: string, file: File | null) => {
    setPhotos(prev => ({ ...prev, [photoId]: file }));
  };

  const triggerFileInput = (photoId: string) => {
    fileInputRefs.current[photoId]?.click();
  };

  const requiredCount = PHOTO_GUIDES.filter(g => g.required).length;
  const uploadedRequired = PHOTO_GUIDES.filter(g => g.required && photos[g.id]).length;
  const canSubmit = uploadedRequired >= requiredCount;

  const handleSubmit = async () => {
    if (!canSubmit) {
      toast.error('Please upload all required photos');
      return;
    }

    setIsUploading(true);
    const requestId = crypto.randomUUID();
    const photoPaths: string[] = [];

    try {
      // Upload all photos
      for (const [photoId, file] of Object.entries(photos)) {
        if (!file) continue;
        
        const filePath = `${dealerName}/${requestId}/${photoId}-${Date.now()}.${file.name.split('.').pop()}`;
        const { error: uploadError } = await supabase.storage
          .from('valo-photos')
          .upload(filePath, file);

        if (uploadError) {
          console.error('Upload error:', uploadError);
          throw new Error(`Failed to upload ${photoId} photo`);
        }
        
        photoPaths.push(filePath);
      }

      // Create review request
      const { error: insertError } = await supabase
        .from('valo_review_requests')
        .insert({
          id: requestId,
          dealer_name: dealerName,
          vehicle_summary: vehicleSummary,
          frank_response: frankResponse,
          buy_range_min: result.suggested_buy_range?.min || null,
          buy_range_max: result.suggested_buy_range?.max || null,
          sell_range_min: result.suggested_sell_range?.min || null,
          sell_range_max: result.suggested_sell_range?.max || null,
          confidence: result.confidence,
          tier: result.tier,
          parsed_vehicle: parsed as any,
          photo_paths: photoPaths,
          status: 'pending',
        });

      if (insertError) {
        console.error('Insert error:', insertError);
        throw new Error('Failed to create review request');
      }

      // Log the creation
      await supabase.from('valo_review_logs').insert({
        request_id: requestId,
        action: 'created',
        actor: dealerName,
        note: `Photos uploaded: ${photoPaths.length}`,
      });

      toast.success("Photos sent to Frank's team for review");
      setIsOpen(false);
      setPhotos({});
      onSubmitted(requestId);
    } catch (err) {
      console.error('Submit error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to submit photos');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <>
      <Button 
        onClick={() => setIsOpen(true)} 
        className="gap-2"
        variant="default"
      >
        <Camera className="h-4 w-4" />
        Send Pics to Frank
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Send Pics to Frank
            </DialogTitle>
            <DialogDescription>
              Upload 4-5 photos for a human review. Frank's team will get back to you.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            {PHOTO_GUIDES.map((guide) => (
              <div 
                key={guide.id}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  photos[guide.id] ? 'border-green-500 bg-green-500/10' : 'border-border'
                }`}
              >
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  ref={el => fileInputRefs.current[guide.id] = el}
                  onChange={(e) => handlePhotoSelect(guide.id, e.target.files?.[0] || null)}
                />
                
                <div className="flex-1">
                  <p className="font-medium text-sm">
                    {guide.label}
                    {!guide.required && <span className="text-muted-foreground ml-1">(optional)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{guide.description}</p>
                </div>

                {photos[guide.id] ? (
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={() => handlePhotoSelect(guide.id, null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => triggerFileInput(guide.id)}
                    className="gap-1"
                  >
                    <Upload className="h-3 w-3" />
                    Add
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center mt-4 pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              {uploadedRequired}/{requiredCount} required photos
            </p>
            <Button 
              onClick={handleSubmit} 
              disabled={!canSubmit || isUploading}
              className="gap-2"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4" />
                  Send to Frank
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}