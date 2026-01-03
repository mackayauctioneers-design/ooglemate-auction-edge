import { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Camera, Loader2, X, Check, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { ValoResult, ValoParsedVehicle } from '@/types';

// ============================================================================
// FRANK: Live phone call, not a chatbot
// ============================================================================
// - Tap Frank → opens listening immediately (like picking up a phone)
// - Frank SPEAKS his responses (TTS) - no play button needed
// - If user starts talking, Frank stops speaking and listens
// - Text always visible for reference
// - No toggles, no modes - Frank always speaks and listens
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
  { id: 'front', label: 'Front 3/4', required: true },
  { id: 'rear', label: 'Rear 3/4', required: true },
  { id: 'interior', label: 'Interior', required: true },
  { id: 'engine', label: 'Engine', required: true },
];

const SILENCE_TIMEOUT_MS = 1800; // Slightly longer for natural speech

// Get Australian male voice if available, otherwise neutral male
function getFrankVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  
  // Priority: Australian English male voices
  const aussieMale = voices.find(v => 
    v.lang.includes('en-AU') && v.name.toLowerCase().includes('male')
  );
  if (aussieMale) return aussieMale;
  
  // Fallback: Any Australian English voice
  const aussieVoice = voices.find(v => v.lang.includes('en-AU'));
  if (aussieVoice) return aussieVoice;
  
  // Fallback: UK/US male voices
  const englishMale = voices.find(v => 
    (v.lang.includes('en-GB') || v.lang.includes('en-US')) && 
    (v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('daniel') || v.name.toLowerCase().includes('james'))
  );
  if (englishMale) return englishMale;
  
  // Fallback: Any English voice
  const englishVoice = voices.find(v => v.lang.startsWith('en'));
  return englishVoice || null;
}

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
  // Conversation state
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Photo capture state
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);
  const [photos, setPhotos] = useState<Record<string, File | null>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  
  // Refs
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const accumulatedTranscriptRef = useRef('');
  const lastSpokenResponseRef = useRef<string | null>(null);

  // Stop Frank speaking (when user interrupts)
  const stopSpeaking = useCallback(() => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, []);

  // Speak Frank's response
  const speakResponse = useCallback((text: string) => {
    if (!text || !window.speechSynthesis) return;
    
    // Don't speak the same response twice
    if (lastSpokenResponseRef.current === text) return;
    lastSpokenResponseRef.current = text;
    
    // Cancel any ongoing speech
    stopSpeaking();
    
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getFrankVoice();
    if (voice) {
      utterance.voice = voice;
    }
    utterance.rate = 1.0;
    utterance.pitch = 0.95; // Slightly lower for male voice
    utterance.volume = 1.0;
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    // Small delay to ensure voices are loaded
    setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 100);
  }, [stopSpeaking]);

  // Auto-speak Frank's response when it changes
  useEffect(() => {
    if (frankResponse && isOpen && !isProcessing && !isListening) {
      speakResponse(frankResponse);
    }
  }, [frankResponse, isOpen, isProcessing, isListening, speakResponse]);

  // Load voices on mount (some browsers load them async)
  useEffect(() => {
    const loadVoices = () => {
      window.speechSynthesis?.getVoices();
    };
    loadVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', loadVoices);
    };
  }, []);

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
      // INTERRUPT: Stop Frank speaking if user starts talking
      if (isSpeaking) {
        stopSpeaking();
      }
      
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

      // Accumulate final transcript
      if (finalTranscript) {
        accumulatedTranscriptRef.current = (accumulatedTranscriptRef.current + ' ' + finalTranscript).trim();
      }

      // Show what Frank's hearing (live feedback like a call)
      setCurrentTranscript(accumulatedTranscriptRef.current + (interimTranscript ? ' ' + interimTranscript : ''));

      // Set silence timer - auto-process after natural pause
      silenceTimerRef.current = setTimeout(() => {
        finishListeningAndProcess();
      }, SILENCE_TIMEOUT_MS);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech error:', event.error);
      if (event.error === 'not-allowed') {
        toast.error('Need mic access to talk to Frank');
        setIsOpen(false);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      stopSpeaking();
    };
  }, [isSpeaking, stopSpeaking]);

  // Auto-open photo capture when Frank needs photos
  useEffect(() => {
    if (needsPhotos && frankResponse && dealerName && !showPhotoCapture) {
      const timer = setTimeout(() => {
        setShowPhotoCapture(true);
        setCurrentPhotoIndex(0);
        // Auto-trigger camera
        setTimeout(() => cameraInputRef.current?.click(), 300);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [needsPhotos, frankResponse, dealerName, showPhotoCapture]);

  const finishListeningAndProcess = useCallback(() => {
    if (!recognitionRef.current) return;
    
    recognitionRef.current.stop();
    setIsListening(false);

    const finalText = accumulatedTranscriptRef.current.trim();
    if (finalText) {
      onProcess(finalText);
    }
    
    accumulatedTranscriptRef.current = '';
    setCurrentTranscript('');
  }, [onProcess]);

  const startListening = useCallback(async () => {
    if (!recognitionRef.current) return;

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      accumulatedTranscriptRef.current = '';
      setCurrentTranscript('');
      recognitionRef.current.start();
      setIsListening(true);
    } catch (error) {
      console.error('Mic error:', error);
      toast.error('Could not access microphone');
      setIsOpen(false);
    }
  }, []);

  // Open Frank = start listening immediately (like answering a call)
  const handleOpenFrank = useCallback(() => {
    if (isProcessing) return;
    setIsOpen(true);
    // Small delay to let dialog open, then start listening
    setTimeout(() => startListening(), 200);
  }, [isProcessing, startListening]);

  const handleClose = () => {
    // Stop listening
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    // Stop speaking
    stopSpeaking();
    lastSpokenResponseRef.current = null; // Reset so response can be spoken again if reopened
    
    setIsListening(false);
    setCurrentTranscript('');
    accumulatedTranscriptRef.current = '';
    setIsOpen(false);
  };

  // Photo capture handlers
  const handlePhotoCapture = (file: File | null) => {
    if (!file) return;
    
    const currentGuide = PHOTO_GUIDES[currentPhotoIndex];
    setPhotos(prev => ({ ...prev, [currentGuide.id]: file }));
    
    if (currentPhotoIndex < PHOTO_GUIDES.length - 1) {
      setCurrentPhotoIndex(prev => prev + 1);
      setTimeout(() => cameraInputRef.current?.click(), 400);
    } else {
      handleSubmitPhotos();
    }
  };

  const handleSubmitPhotos = async () => {
    if (!result || !parsed || !dealerName) return;
    
    const hasAllRequired = PHOTO_GUIDES.filter(g => g.required).every(g => photos[g.id]);
    if (!hasAllRequired) {
      toast.error('Need all photos');
      return;
    }

    setIsUploading(true);
    const requestId = crypto.randomUUID();
    const photoPaths: string[] = [];

    try {
      for (const [photoId, file] of Object.entries(photos)) {
        if (!file) continue;
        const filePath = `${dealerName}/${requestId}/${photoId}-${Date.now()}.${file.name.split('.').pop()}`;
        const { error } = await supabase.storage.from('valo-photos').upload(filePath, file);
        if (error) throw new Error(`Upload failed`);
        photoPaths.push(filePath);
      }

      const vehicleSummary = [parsed.year, parsed.make, parsed.model, parsed.variant_family]
        .filter(Boolean).join(' ');

      await supabase.from('valo_review_requests').insert({
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

      await supabase.from('valo_review_logs').insert({
        request_id: requestId,
        action: 'created',
        actor: dealerName,
        note: `${photoPaths.length} photos`,
      });

      toast.success("Sent. I'll get back to you.");
      setShowPhotoCapture(false);
      setPhotos({});
      onPhotoSubmitted?.(requestId);
    } catch (err) {
      toast.error('Failed to send');
    } finally {
      setIsUploading(false);
    }
  };

  const uploadedCount = Object.values(photos).filter(Boolean).length;

  // Fallback for unsupported browsers
  const [fallbackText, setFallbackText] = useState('');

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

      {/* Floating Frank Avatar - tap to call */}
      <button
        onClick={handleOpenFrank}
        disabled={isProcessing}
        className={cn(
          "fixed bottom-6 right-6 z-50 w-16 h-16 rounded-full shadow-xl",
          "flex items-center justify-center transition-all duration-200",
          "bg-gradient-to-br from-primary to-primary/80",
          "hover:scale-105 active:scale-95",
          isProcessing && "opacity-60"
        )}
        aria-label="Talk to Frank"
      >
        {isProcessing ? (
          <Loader2 className="h-7 w-7 animate-spin text-primary-foreground" />
        ) : (
          <span className="text-3xl">👨‍🔧</span>
        )}
      </button>
      <span className="fixed bottom-2 right-8 z-50 text-xs font-medium text-muted-foreground">
        Frank
      </span>

      {/* Frank conversation dialog - feels like a call */}
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-sm p-0 overflow-hidden gap-0">
          {/* Frank's face - call header */}
          <div className="bg-gradient-to-br from-primary to-primary/80 p-6 text-center text-primary-foreground">
            <div className="text-5xl mb-2">👨‍🔧</div>
            <p className="font-semibold text-lg">Frank</p>
            {isSpeaking && (
              <div className="flex items-center justify-center gap-1.5 mt-1">
                <Volume2 className="h-4 w-4 animate-pulse" />
                <p className="text-sm opacity-90">Speaking...</p>
              </div>
            )}
            {isListening && !isSpeaking && (
              <p className="text-sm opacity-90 animate-pulse mt-1">Listening...</p>
            )}
            {isProcessing && (
              <p className="text-sm opacity-90 mt-1">Thinking...</p>
            )}
          </div>

          {/* Conversation area */}
          <div className="p-4 min-h-[120px] max-h-[300px] overflow-y-auto">
            {/* Show what user is saying (live) */}
            {isListening && currentTranscript && (
              <div className="bg-muted rounded-lg p-3 text-sm mb-3">
                <p className="text-muted-foreground text-xs mb-1">You:</p>
                <p>{currentTranscript}</p>
              </div>
            )}

            {/* Frank's response */}
            {frankResponse && !isListening && !isProcessing && (
              <div className="bg-primary/10 rounded-lg p-3 text-sm">
                <p className="text-muted-foreground text-xs mb-1">Frank:</p>
                <p className="leading-relaxed">{frankResponse}</p>
              </div>
            )}

            {/* Empty state - just started listening */}
            {isListening && !currentTranscript && (
              <div className="flex items-center justify-center h-20">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            {/* Processing state */}
            {isProcessing && (
              <div className="flex items-center justify-center h-20">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            )}

            {/* Fallback text input for unsupported browsers */}
            {!isSupported && !frankResponse && (
              <div className="space-y-3">
                <textarea
                  value={fallbackText}
                  onChange={(e) => setFallbackText(e.target.value)}
                  placeholder="Type the car details..."
                  className="w-full p-3 text-sm border rounded-lg resize-none bg-background"
                  rows={3}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && fallbackText.trim()) {
                      e.preventDefault();
                      onProcess(fallbackText.trim());
                      setFallbackText('');
                    }
                  }}
                />
              </div>
            )}
          </div>

          {/* Close button - subtle */}
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 text-primary-foreground/70 hover:text-primary-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </DialogContent>
      </Dialog>

      {/* Photo capture dialog */}
      <Dialog open={showPhotoCapture} onOpenChange={setShowPhotoCapture}>
        <DialogContent className="max-w-xs p-4">
          <div className="text-center space-y-4">
            <Camera className="h-8 w-8 mx-auto text-primary" />
            <div>
              <p className="font-medium">
                {currentPhotoIndex < PHOTO_GUIDES.length 
                  ? PHOTO_GUIDES[currentPhotoIndex].label
                  : 'Done!'
                }
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {uploadedCount}/{PHOTO_GUIDES.length}
              </p>
            </div>

            <div className="flex justify-center gap-2">
              {PHOTO_GUIDES.map((guide, i) => (
                <div 
                  key={guide.id}
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs border-2",
                    photos[guide.id] 
                      ? "border-green-500 bg-green-500/20" 
                      : i === currentPhotoIndex 
                        ? "border-primary animate-pulse"
                        : "border-muted"
                  )}
                >
                  {photos[guide.id] ? <Check className="h-4 w-4 text-green-500" /> : i + 1}
                </div>
              ))}
            </div>

            {isUploading && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
