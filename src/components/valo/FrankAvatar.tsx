import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Camera, Loader2, Volume2, VolumeX, Check, X, Upload, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { ValoResult, ValoParsedVehicle } from '@/types';

// ============================================================================
// FRANK AVATAR: Single entry point for all Frank interactions
// ============================================================================
// - Floating avatar bottom-right, always visible
// - Tap to start voice recording (auto-stops on 1.5s silence)
// - Shows editable transcript, auto-processes
// - Opens camera directly when Frank needs photos
// - Text bubble response with optional voice playback
// ============================================================================

interface FrankAvatarProps {
  onProcess: (text: string) => Promise<void>;
  isProcessing: boolean;
  frankResponse: string | null;
  result: ValoResult | null;
  parsed: ValoParsedVehicle | null;
  dealerName?: string;
  onPhotoSubmitted?: (requestId: string) => void;
  needsPhotos: boolean;
}

const PHOTO_GUIDES = [
  { id: 'front', label: 'Front 3/4', description: 'Front corner', required: true },
  { id: 'rear', label: 'Rear 3/4', description: 'Rear corner', required: true },
  { id: 'interior', label: 'Interior', description: 'Dashboard', required: true },
  { id: 'engine', label: 'Engine', description: 'Engine bay', required: true },
];

const SILENCE_TIMEOUT_MS = 1500;

export function FrankAvatar({ 
  onProcess, 
  isProcessing, 
  frankResponse, 
  result, 
  parsed,
  dealerName,
  onPhotoSubmitted,
  needsPhotos 
}: FrankAvatarProps) {
  // Voice state
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editableText, setEditableText] = useState('');
  const [isSupported, setIsSupported] = useState(true);
  
  // Response state
  const [showResponse, setShowResponse] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  
  // Photo capture state
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);
  const [photos, setPhotos] = useState<Record<string, File | null>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  
  // Refs
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Initialize speech recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-AU';

    recognition.onresult = (event: any) => {
      // Reset silence timer on any speech
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }

      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      // Update transcript
      if (finalTranscript) {
        setTranscript(prev => (prev + ' ' + finalTranscript).trim());
      }

      // Set silence timer - stop recording after 1.5s of silence
      silenceTimerRef.current = setTimeout(() => {
        stopListening();
      }, SILENCE_TIMEOUT_MS);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        toast.error('Microphone access denied');
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    };
  }, []);

  // Auto-process after recording stops with transcript
  useEffect(() => {
    if (!isListening && transcript && !isEditing && !isProcessing) {
      setEditableText(transcript);
      setIsEditing(true);
    }
  }, [isListening, transcript, isEditing, isProcessing]);

  // Show response when Frank responds
  useEffect(() => {
    if (frankResponse) {
      setShowResponse(true);
    }
  }, [frankResponse]);

  // Auto-open photo capture when Frank needs photos
  useEffect(() => {
    if (needsPhotos && showResponse && dealerName) {
      // Small delay to let user read response first
      const timer = setTimeout(() => {
        setShowPhotoCapture(true);
        setCurrentPhotoIndex(0);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [needsPhotos, showResponse, dealerName]);

  const startListening = useCallback(async () => {
    if (!recognitionRef.current || isProcessing) return;

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setTranscript('');
      setIsEditing(false);
      setShowResponse(false);
      recognitionRef.current.start();
      setIsListening(true);
    } catch (error) {
      console.error('Failed to start listening:', error);
      toast.error('Could not access microphone');
    }
  }, [isProcessing]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
    setIsListening(false);
  }, []);

  const handleAvatarTap = () => {
    if (isProcessing) return;
    
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handleRunFrank = async () => {
    if (!editableText.trim()) return;
    setIsEditing(false);
    await onProcess(editableText.trim());
    setTranscript('');
    setEditableText('');
  };

  // Photo capture handlers
  const handlePhotoCapture = (file: File | null) => {
    if (!file) return;
    
    const currentGuide = PHOTO_GUIDES[currentPhotoIndex];
    setPhotos(prev => ({ ...prev, [currentGuide.id]: file }));
    
    // Move to next photo or finish
    if (currentPhotoIndex < PHOTO_GUIDES.length - 1) {
      setCurrentPhotoIndex(prev => prev + 1);
      // Trigger next capture
      setTimeout(() => {
        cameraInputRef.current?.click();
      }, 500);
    } else {
      // All photos captured, auto-submit
      handleSubmitPhotos();
    }
  };

  const handleSubmitPhotos = async () => {
    if (!result || !parsed || !dealerName) return;
    
    const requiredPhotos = PHOTO_GUIDES.filter(g => g.required);
    const hasAllRequired = requiredPhotos.every(g => photos[g.id]);
    
    if (!hasAllRequired) {
      toast.error('Please capture all required photos');
      return;
    }

    setIsUploading(true);
    const requestId = crypto.randomUUID();
    const photoPaths: string[] = [];

    try {
      for (const [photoId, file] of Object.entries(photos)) {
        if (!file) continue;
        
        const filePath = `${dealerName}/${requestId}/${photoId}-${Date.now()}.${file.name.split('.').pop()}`;
        const { error: uploadError } = await supabase.storage
          .from('valo-photos')
          .upload(filePath, file);

        if (uploadError) throw new Error(`Failed to upload ${photoId}`);
        photoPaths.push(filePath);
      }

      const vehicleSummary = [parsed.year, parsed.make, parsed.model, parsed.variant_family]
        .filter(Boolean).join(' ');

      const { error: insertError } = await supabase
        .from('valo_review_requests')
        .insert({
          id: requestId,
          dealer_name: dealerName,
          vehicle_summary: vehicleSummary,
          frank_response: frankResponse || '',
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

      if (insertError) throw new Error('Failed to create review request');

      await supabase.from('valo_review_logs').insert({
        request_id: requestId,
        action: 'created',
        actor: dealerName,
        note: `Photos: ${photoPaths.length}`,
      });

      toast.success("Sent to Frank's team!");
      setShowPhotoCapture(false);
      setPhotos({});
      setCurrentPhotoIndex(0);
      onPhotoSubmitted?.(requestId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send photos');
    } finally {
      setIsUploading(false);
    }
  };

  const startPhotoCapture = () => {
    setCurrentPhotoIndex(0);
    setPhotos({});
    cameraInputRef.current?.click();
  };

  const uploadedCount = Object.values(photos).filter(Boolean).length;

  return (
    <>
      {/* Hidden camera input */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handlePhotoCapture(e.target.files?.[0] || null)}
      />

      {/* Floating Frank Avatar */}
      <button
        onClick={handleAvatarTap}
        disabled={isProcessing}
        className={cn(
          "fixed bottom-6 right-6 z-50 w-16 h-16 rounded-full shadow-lg",
          "flex items-center justify-center transition-all duration-300",
          "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground",
          "hover:scale-110 active:scale-95",
          isListening && "ring-4 ring-destructive ring-offset-2 animate-pulse",
          isProcessing && "opacity-70 cursor-not-allowed"
        )}
        aria-label="Talk to Frank"
      >
        {isProcessing ? (
          <Loader2 className="h-8 w-8 animate-spin" />
        ) : isListening ? (
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-destructive animate-ping opacity-50" />
            <span className="text-2xl">🎤</span>
          </div>
        ) : (
          <span className="text-3xl">👨‍🔧</span>
        )}
      </button>

      {/* Frank label */}
      <div className="fixed bottom-2 right-6 z-50 text-center">
        <span className="text-xs font-medium text-muted-foreground">Frank</span>
      </div>

      {/* Listening indicator */}
      {isListening && (
        <div className="fixed bottom-24 right-6 z-50 bg-destructive text-destructive-foreground px-4 py-2 rounded-full text-sm font-medium animate-pulse">
          Listening... speak now
        </div>
      )}

      {/* Editable transcript */}
      {isEditing && !isProcessing && (
        <div className="fixed bottom-24 right-6 z-50 w-72 bg-card border rounded-xl shadow-xl p-4 space-y-3">
          <p className="text-sm text-muted-foreground">I heard:</p>
          <textarea
            value={editableText}
            onChange={(e) => setEditableText(e.target.value)}
            className="w-full p-2 text-sm border rounded-lg resize-none bg-background"
            rows={3}
            autoFocus
          />
          <div className="flex gap-2">
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => { setIsEditing(false); setEditableText(''); }}
            >
              Cancel
            </Button>
            <Button 
              size="sm" 
              onClick={handleRunFrank}
              disabled={!editableText.trim()}
              className="flex-1 gap-1"
            >
              <Send className="h-3 w-3" />
              Run Frank
            </Button>
          </div>
        </div>
      )}

      {/* Frank's response bubble */}
      {showResponse && frankResponse && !isEditing && (
        <div className="fixed bottom-24 right-6 z-50 w-80 max-h-96 overflow-y-auto bg-card border rounded-xl shadow-xl">
          <div className="sticky top-0 bg-card border-b p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">👨‍🔧</span>
              <span className="font-medium">Frank says</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setVoiceEnabled(!voiceEnabled)}
                className="h-8 w-8 p-0"
              >
                {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowResponse(false)}
                className="h-8 w-8 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="p-4">
            <p className="text-sm leading-relaxed">{frankResponse}</p>
          </div>
          
          {/* Photo prompt */}
          {needsPhotos && dealerName && (
            <div className="border-t p-3">
              <Button 
                onClick={startPhotoCapture}
                className="w-full gap-2"
                size="sm"
              >
                <Camera className="h-4 w-4" />
                Send Pics to Frank
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Photo capture dialog */}
      <Dialog open={showPhotoCapture} onOpenChange={setShowPhotoCapture}>
        <DialogContent className="max-w-sm">
          <div className="space-y-4">
            <div className="text-center">
              <Camera className="h-10 w-10 mx-auto text-primary mb-2" />
              <h3 className="font-semibold">
                {currentPhotoIndex < PHOTO_GUIDES.length 
                  ? `Photo ${currentPhotoIndex + 1}/${PHOTO_GUIDES.length}`
                  : 'All photos captured!'
                }
              </h3>
              {currentPhotoIndex < PHOTO_GUIDES.length && (
                <p className="text-sm text-muted-foreground mt-1">
                  {PHOTO_GUIDES[currentPhotoIndex].label}: {PHOTO_GUIDES[currentPhotoIndex].description}
                </p>
              )}
            </div>

            {/* Photo status */}
            <div className="grid grid-cols-4 gap-2">
              {PHOTO_GUIDES.map((guide, i) => (
                <div 
                  key={guide.id}
                  className={cn(
                    "aspect-square rounded-lg border-2 flex items-center justify-center text-xs",
                    photos[guide.id] 
                      ? "border-green-500 bg-green-500/10" 
                      : i === currentPhotoIndex 
                        ? "border-primary border-dashed animate-pulse"
                        : "border-muted"
                  )}
                >
                  {photos[guide.id] ? (
                    <Check className="h-5 w-5 text-green-500" />
                  ) : (
                    <span className="text-muted-foreground">{i + 1}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {uploadedCount < PHOTO_GUIDES.length ? (
                <Button 
                  onClick={startPhotoCapture}
                  className="flex-1 gap-2"
                  disabled={isUploading}
                >
                  <Camera className="h-4 w-4" />
                  {uploadedCount === 0 ? 'Start Camera' : 'Continue'}
                </Button>
              ) : (
                <Button 
                  onClick={handleSubmitPhotos}
                  className="flex-1 gap-2"
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Send to Frank
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fallback text input for non-supported browsers */}
      {!isSupported && !showResponse && (
        <div className="fixed bottom-24 right-6 z-50 w-72 bg-card border rounded-xl shadow-xl p-4 space-y-3">
          <p className="text-sm text-muted-foreground">Type your question:</p>
          <textarea
            value={editableText}
            onChange={(e) => setEditableText(e.target.value)}
            className="w-full p-2 text-sm border rounded-lg resize-none bg-background"
            rows={3}
            placeholder="e.g., 2020 Hilux SR5 40,000 km"
          />
          <Button 
            size="sm" 
            onClick={handleRunFrank}
            disabled={!editableText.trim() || isProcessing}
            className="w-full gap-1"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Frank's thinking...
              </>
            ) : (
              <>
                <Send className="h-3 w-3" />
                Ask Frank
              </>
            )}
          </Button>
        </div>
      )}
    </>
  );
}
