import { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Loader2, X, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ============================================================================
// FRANK: Voice-first AI agent - feels like a phone call
// ============================================================================
// - Tap Frank → opens and starts listening (like picking up a phone)
// - User speaks → transcript sent to AI backend
// - Frank responds via AI → auto-plays TTS
// - If user talks while Frank speaks → interrupt and listen
// - No buttons, no toggles - pure voice conversation
// ============================================================================

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface FrankAvatarProps {
  dealerName?: string;
}

const SILENCE_TIMEOUT_MS = 1800;

// Get Australian male voice if available
function getFrankVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  
  const aussieMale = voices.find(v => 
    v.lang.includes('en-AU') && v.name.toLowerCase().includes('male')
  );
  if (aussieMale) return aussieMale;
  
  const aussieVoice = voices.find(v => v.lang.includes('en-AU'));
  if (aussieVoice) return aussieVoice;
  
  const englishMale = voices.find(v => 
    (v.lang.includes('en-GB') || v.lang.includes('en-US')) && 
    (v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('daniel'))
  );
  if (englishMale) return englishMale;
  
  return voices.find(v => v.lang.startsWith('en')) || null;
}

export function FrankAvatar({ dealerName }: FrankAvatarProps) {
  // Conversation state
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Conversation history for multi-turn
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [latestResponse, setLatestResponse] = useState<string | null>(null);
  
  // Refs
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const accumulatedTranscriptRef = useRef('');
  const lastSpokenResponseRef = useRef<string | null>(null);

  // Stop Frank speaking
  const stopSpeaking = useCallback(() => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, []);

  // Speak Frank's response
  const speakResponse = useCallback((text: string) => {
    if (!text || !window.speechSynthesis) return;
    
    if (lastSpokenResponseRef.current === text) return;
    lastSpokenResponseRef.current = text;
    
    stopSpeaking();
    
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getFrankVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 1.0;
    utterance.pitch = 0.95;
    utterance.volume = 1.0;
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 100);
  }, [stopSpeaking]);

  // Auto-speak when response changes
  useEffect(() => {
    if (latestResponse && isOpen && !isProcessing && !isListening) {
      speakResponse(latestResponse);
    }
  }, [latestResponse, isOpen, isProcessing, isListening, speakResponse]);

  // Load voices
  useEffect(() => {
    const loadVoices = () => window.speechSynthesis?.getVoices();
    loadVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', loadVoices);
  }, []);

  // Call Frank AI backend
  const callFrankAPI = useCallback(async (transcript: string) => {
    setIsProcessing(true);
    
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/frank`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            transcript,
            conversationHistory: conversation,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 429) {
          toast.error("Too many requests - slow down");
        } else if (response.status === 402) {
          toast.error("Credits needed");
        } else {
          toast.error(errorData.error || "Frank's having a moment");
        }
        return;
      }

      const data = await response.json();
      const frankResponse = data.response;
      
      if (frankResponse) {
        // Update conversation history
        setConversation(prev => [
          ...prev,
          { role: 'user', content: transcript },
          { role: 'assistant', content: frankResponse }
        ]);
        setLatestResponse(frankResponse);
      }
    } catch (error) {
      console.error('Frank API error:', error);
      toast.error("Couldn't reach Frank");
    } finally {
      setIsProcessing(false);
    }
  }, [conversation]);

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
      // Interrupt Frank if user starts talking
      if (isSpeaking) stopSpeaking();
      
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

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

      if (finalTranscript) {
        accumulatedTranscriptRef.current = (accumulatedTranscriptRef.current + ' ' + finalTranscript).trim();
      }

      setCurrentTranscript(accumulatedTranscriptRef.current + (interimTranscript ? ' ' + interimTranscript : ''));

      // Auto-process after silence
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

    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;

    return () => {
      recognitionRef.current?.abort();
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      stopSpeaking();
    };
  }, [isSpeaking, stopSpeaking]);

  const finishListeningAndProcess = useCallback(() => {
    if (!recognitionRef.current) return;
    
    recognitionRef.current.stop();
    setIsListening(false);

    const finalText = accumulatedTranscriptRef.current.trim();
    if (finalText) {
      callFrankAPI(finalText);
    }
    
    accumulatedTranscriptRef.current = '';
    setCurrentTranscript('');
  }, [callFrankAPI]);

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

  // Open Frank = start listening immediately
  const handleOpenFrank = useCallback(() => {
    if (isProcessing) return;
    setIsOpen(true);
    setTimeout(() => startListening(), 200);
  }, [isProcessing, startListening]);

  const handleClose = () => {
    recognitionRef.current?.stop();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    stopSpeaking();
    lastSpokenResponseRef.current = null;
    
    setIsListening(false);
    setCurrentTranscript('');
    accumulatedTranscriptRef.current = '';
    setIsOpen(false);
  };

  // Fallback text input
  const [fallbackText, setFallbackText] = useState('');

  return (
    <>
      {/* Floating Frank Avatar */}
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

      {/* Conversation Dialog */}
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-sm p-0 overflow-hidden gap-0">
          {/* Header */}
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

          {/* Conversation */}
          <div className="p-4 min-h-[120px] max-h-[300px] overflow-y-auto space-y-3">
            {/* Conversation history */}
            {conversation.slice(-4).map((msg, i) => (
              <div 
                key={i} 
                className={cn(
                  "rounded-lg p-3 text-sm",
                  msg.role === 'user' ? "bg-muted" : "bg-primary/10"
                )}
              >
                <p className="text-muted-foreground text-xs mb-1">
                  {msg.role === 'user' ? 'You:' : 'Frank:'}
                </p>
                <p className="leading-relaxed">{msg.content}</p>
              </div>
            ))}

            {/* Live transcript */}
            {isListening && currentTranscript && (
              <div className="bg-muted rounded-lg p-3 text-sm">
                <p className="text-muted-foreground text-xs mb-1">You:</p>
                <p>{currentTranscript}</p>
              </div>
            )}

            {/* Listening indicator */}
            {isListening && !currentTranscript && conversation.length === 0 && (
              <div className="flex items-center justify-center h-20">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            {/* Processing */}
            {isProcessing && (
              <div className="flex items-center justify-center h-20">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            )}

            {/* Fallback for unsupported browsers */}
            {!isSupported && conversation.length === 0 && (
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
                    callFrankAPI(fallbackText.trim());
                    setFallbackText('');
                  }
                }}
              />
            )}
          </div>

          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 text-primary-foreground/70 hover:text-primary-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
