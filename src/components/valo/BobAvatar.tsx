import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Loader2, X, Volume2, Mic, MicOff, Bug } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import bobAvatarVideo from '@/assets/bob-avatar.mp4';
// ============================================================================
// BOB: Voice-first AI using OpenAI Realtime API (WebRTC)
// Native conversational voice streams directly - no separate TTS needed
// ============================================================================

// Bob push notification context type
interface BobPushContext {
  alert_type: 'upcoming_watched' | 'auction_reminder' | 'passed_in' | 'price_drop' | 'buy_signal';
  vehicle: {
    year?: number;
    make: string;
    model: string;
    variant?: string;
  };
  context: {
    auction_house?: string;
    location?: string;
    auction_time?: string;
    lot_id?: string;
    price_drop_amount?: number;
    current_price?: number;
    estimated_margin?: number;
  };
  speak_context?: string;
}

interface BobAvatarProps {
  dealerName?: string;
  dealership?: string;
  triggerBrief?: boolean; // Set true on login to auto-trigger daily brief
}

export function BobAvatar({ dealerName = 'mate', dealership = '', triggerBrief = false }: BobAvatarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Connection state
  const [isOpen, setIsOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [audioActive, setAudioActive] = useState(false);
  const [briefMode, setBriefMode] = useState(false);
  const [hasTriggeredBrief, setHasTriggeredBrief] = useState(false);
  const [pushContext, setPushContext] = useState<BobPushContext | null>(null);
  
  // Transcripts
  const [userTranscript, setUserTranscript] = useState('');
  const [bobTranscript, setBobTranscript] = useState('');
  const [conversationHistory, setConversationHistory] = useState<Array<{role: string, text: string}>>([]);

  // WebRTC refs
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  const disconnect = useCallback(() => {
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
    }
    setIsConnected(false);
    setIsListening(false);
    setIsSpeaking(false);
    setAudioActive(false);
  }, []);

  const connect = useCallback(async (options: { withBrief?: boolean; withPushContext?: BobPushContext | null } = {}) => {
    const { withBrief = false, withPushContext = null } = options;
    setIsConnecting(true);
    setBriefMode(withBrief);
    
    try {
      let briefContext = '';
      
      // If in brief mode, first fetch the brief context
      if (withBrief && !withPushContext) {
        console.log("Fetching daily brief context...");
        const { data: briefData, error: briefError } = await supabase.functions.invoke('bob-daily-brief', {
          body: { dealerName, dealership },
        });
        
        if (!briefError && briefData) {
          briefContext = briefData.briefContext || '';
          console.log("Brief context loaded, opportunities:", briefData.opportunityCount);
        }
      }

      // Get ephemeral token from edge function
      const { data, error: tokenError } = await supabase.functions.invoke('bob-realtime-token', {
        body: { 
          briefMode: withBrief, 
          briefContext,
          pushMode: !!withPushContext,
          pushContext: withPushContext,
        },
      });

      if (tokenError || !data) {
        throw new Error('Failed to get session token');
      }
      
      if (!data.client_secret?.value) {
        throw new Error('No ephemeral token received');
      }

      const EPHEMERAL_KEY = data.client_secret.value;
      const modeLabel = withPushContext ? "(PUSH MODE)" : withBrief ? "(BRIEF MODE)" : "";
      console.log("Got ephemeral token, establishing WebRTC connection...", modeLabel);

      // Create peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Create audio element for remote audio (Bob's voice)
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioElRef.current = audioEl;

      // Set up remote audio - this is where Bob's voice comes through
      pc.ontrack = (e) => {
        console.log("Received remote audio track - Bob's voice connected");
        audioEl.srcObject = e.streams[0];
        setAudioActive(true);
        
        // Try to play (may need user interaction on mobile)
        audioEl.play().catch(err => {
          console.warn("Audio autoplay blocked:", err);
          toast.info("Tap anywhere to enable Bob's voice");
        });
      };

      // Get local audio and add to peer connection
      let localStream: MediaStream;
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          } 
        });
      } catch (micError) {
        console.error("Microphone access denied:", micError);
        toast.error("Mic access required. Please enable microphone in your browser settings and try again.", {
          duration: 5000,
        });
        disconnect();
        setIsConnecting(false);
        return;
      }
      localStreamRef.current = localStream;
      pc.addTrack(localStream.getTracks()[0]);
      setIsListening(true);

      // Set up data channel for events
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      dc.addEventListener('open', () => {
        console.log("Data channel open");
        setIsConnected(true);
        setIsConnecting(false);
      });

      dc.addEventListener('message', (e) => {
        const event = JSON.parse(e.data);
        handleRealtimeEvent(event);
      });

      dc.addEventListener('close', () => {
        console.log("Data channel closed");
        setIsConnected(false);
      });

      // Create and set local description
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Connect to OpenAI's Realtime API
      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";
      
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp"
        },
      });

      if (!sdpResponse.ok) {
        throw new Error('Failed to establish WebRTC connection');
      }

      const answer: RTCSessionDescriptionInit = {
        type: "answer",
        sdp: await sdpResponse.text(),
      };
      
      await pc.setRemoteDescription(answer);
      console.log("WebRTC connection established - Bob is ready");

    } catch (error) {
      console.error("Connection error:", error);
      toast.error("Couldn't connect to Bob");
      disconnect();
      setIsConnecting(false);
    }
  }, [disconnect, dealerName, dealership]);

  const handleRealtimeEvent = useCallback((event: any) => {
    console.log("Realtime event:", event.type);

    switch (event.type) {
      case 'session.created':
        console.log("Session created - Bob is online");
        break;

      case 'input_audio_buffer.speech_started':
        setIsListening(true);
        setIsSpeaking(false);
        break;

      case 'input_audio_buffer.speech_stopped':
        setIsListening(false);
        break;

      case 'conversation.item.input_audio_transcription.completed':
        const userText = event.transcript || '';
        if (userText.trim()) {
          setUserTranscript(userText);
          setConversationHistory(prev => [...prev, { role: 'user', text: userText }]);
        }
        break;

      case 'response.audio_transcript.delta':
        setIsSpeaking(true);
        setBobTranscript(prev => prev + (event.delta || ''));
        break;

      case 'response.audio_transcript.done':
        const bobText = event.transcript || bobTranscript;
        if (bobText.trim()) {
          // Add to conversation history (audio plays natively via WebRTC)
          setConversationHistory(prev => [...prev, { role: 'assistant', text: bobText }]);
        }
        setBobTranscript('');
        break;

      case 'response.audio.done':
        setIsSpeaking(false);
        setIsListening(true);
        break;

      case 'response.done':
        setIsSpeaking(false);
        break;

      case 'error':
        console.error("Realtime error:", event.error);
        toast.error("Bob had an issue");
        break;
    }
  }, [bobTranscript]);

  const handleOpenBob = useCallback(async (withBrief = false) => {
    setIsOpen(true);
    setTimeout(() => connect({ withBrief }), 200);
  }, [connect]);

  const handleOpenBobWithPushContext = useCallback(async (context: BobPushContext) => {
    setIsOpen(true);
    setTimeout(() => connect({ withPushContext: context }), 200);
  }, [connect]);

  const handleClose = useCallback(() => {
    disconnect();
    setUserTranscript('');
    setBobTranscript('');
    setConversationHistory([]);
    setIsOpen(false);
    setBriefMode(false);
    setPushContext(null);
  }, [disconnect]);

  // Unlock audio on any user interaction (for mobile)
  const handleUnlockAudio = useCallback(() => {
    if (audioElRef.current && !audioActive) {
      audioElRef.current.play().then(() => {
        setAudioActive(true);
        console.log("Audio unlocked via user interaction");
      }).catch(console.warn);
    }
  }, [audioActive]);

  // Check for bob_context in URL (from push notification tap)
  useEffect(() => {
    const bobContextParam = searchParams.get('bob_context');
    if (bobContextParam && !isOpen) {
      try {
        const context = JSON.parse(decodeURIComponent(bobContextParam)) as BobPushContext;
        console.log('Bob push context from URL:', context);
        setPushContext(context);
        setSearchParams({});
        handleOpenBobWithPushContext(context);
      } catch (err) {
        console.error('Failed to parse bob_context:', err);
      }
    }
  }, [searchParams, isOpen, setSearchParams, handleOpenBobWithPushContext]);

  // Listen for service worker messages (notification clicks when app is open)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICK' && event.data?.bobContext) {
        console.log('Bob context from SW message:', event.data.bobContext);
        setPushContext(event.data.bobContext);
        handleOpenBobWithPushContext(event.data.bobContext);
      }
    };
    
    navigator.serviceWorker?.addEventListener('message', handleMessage);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleMessage);
    };
  }, [handleOpenBobWithPushContext]);

  // Auto-trigger brief on login
  useEffect(() => {
    if (triggerBrief && !hasTriggeredBrief && !isOpen) {
      setHasTriggeredBrief(true);
      handleOpenBob(true);
    }
  }, [triggerBrief, hasTriggeredBrief, isOpen, handleOpenBob]);

  return (
    <>
      {/* Floating Bob Avatar - Video */}
      <button
        onClick={() => handleOpenBob(false)}
        disabled={isConnecting}
        className={cn(
          "fixed bottom-6 right-6 z-50 w-16 h-16 rounded-full shadow-xl",
          "flex items-center justify-center transition-all duration-200",
          "overflow-hidden border-2 border-primary",
          "hover:scale-105 active:scale-95",
          isConnecting && "opacity-60"
        )}
        aria-label="Talk to Bob"
      >
        {isConnecting ? (
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        ) : (
          <video
            src={bobAvatarVideo}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        )}
      </button>
      <span className="fixed bottom-2 right-8 z-50 text-xs font-medium text-muted-foreground">
        Bob
      </span>

      {/* Conversation Dialog */}
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent 
          className="max-w-sm p-0 overflow-hidden gap-0"
          onClick={handleUnlockAudio}
        >
          {/* Header */}
          <div className="bg-gradient-to-br from-primary to-primary/80 p-6 text-center text-primary-foreground relative">
            <div className="w-20 h-20 mx-auto mb-2 rounded-full overflow-hidden border-2 border-primary-foreground/30">
              <video
                src={bobAvatarVideo}
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
            <p className="font-semibold text-lg">Bob</p>
            
            {/* Audio status badge */}
            <div className={cn(
              "absolute top-3 left-3 px-2 py-1 rounded-full text-xs font-medium",
              audioActive ? "bg-green-500/20 text-green-200" : "bg-yellow-500/20 text-yellow-200"
            )}>
              {audioActive ? "🔊 Voice Active" : "🔇 Tap to enable"}
            </div>
            
            {/* Status indicators */}
            <div className="flex items-center justify-center gap-1.5 mt-2 min-h-[24px]">
              {isConnecting && (
                <p className="text-sm opacity-90 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Connecting...
                </p>
              )}
              {isConnected && isSpeaking && (
                <p className="text-sm opacity-90 flex items-center gap-1.5">
                  <Volume2 className="h-4 w-4 animate-pulse" />
                  Bob speaking...
                </p>
              )}
              {isConnected && isListening && !isSpeaking && (
                <p className="text-sm opacity-90 flex items-center gap-1.5 animate-pulse">
                  <Mic className="h-4 w-4" />
                  Listening...
                </p>
              )}
              {isConnected && !isListening && !isSpeaking && (
                <p className="text-sm opacity-90">Ready</p>
              )}
            </div>

            {/* Close button */}
            <button
              onClick={handleClose}
              className="absolute top-3 right-3 text-primary-foreground/70 hover:text-primary-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Debug Panel */}
          {showDebug && (
            <div className="p-2 bg-muted/50 border-b text-xs font-mono space-y-1">
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-1"><Bug className="h-3 w-3" /> Debug</span>
                <button 
                  onClick={() => setShowDebug(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div>Connected: {isConnected ? '✅' : '❌'}</div>
              <div>Audio active: {audioActive ? '✅' : '❌'}</div>
              <div>Speaking: {isSpeaking ? '✅' : '❌'}</div>
              <div>Listening: {isListening ? '✅' : '❌'}</div>
            </div>
          )}

          {/* Conversation area */}
          <div className="p-4 min-h-[150px] max-h-[300px] overflow-y-auto space-y-3">
            {/* Connection state */}
            {isConnecting && (
              <div className="flex items-center justify-center h-24">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Calling Bob...</p>
                </div>
              </div>
            )}

            {/* Conversation history */}
            {conversationHistory.map((msg, i) => (
              <div 
                key={i} 
                className={cn(
                  "rounded-lg p-3 text-sm",
                  msg.role === 'user' ? "bg-muted ml-4" : "bg-primary/10 mr-4"
                )}
              >
                <p className="text-muted-foreground text-xs mb-1">
                  {msg.role === 'user' ? 'You:' : 'Bob:'}
                </p>
                <p className="leading-relaxed">{msg.text}</p>
              </div>
            ))}

            {/* Live user transcript */}
            {userTranscript && isListening && (
              <div className="bg-muted rounded-lg p-3 text-sm ml-4 opacity-70">
                <p className="text-muted-foreground text-xs mb-1">You:</p>
                <p>{userTranscript}</p>
              </div>
            )}

            {/* Live Bob transcript */}
            {bobTranscript && (
              <div className="bg-primary/10 rounded-lg p-3 text-sm mr-4">
                <p className="text-muted-foreground text-xs mb-1">Bob:</p>
                <p className="leading-relaxed">{bobTranscript}</p>
              </div>
            )}

            {/* Initial listening state */}
            {isConnected && conversationHistory.length === 0 && !bobTranscript && !isConnecting && (
              <div className="flex items-center justify-center h-20">
                <div className="text-center">
                  <div className="flex gap-1 justify-center mb-2">
                    <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <p className="text-sm text-muted-foreground">Tell me about the car...</p>
                </div>
              </div>
            )}
          </div>

          {/* Mic indicator */}
          {isConnected && (
            <div className="border-t px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isListening ? (
                  <>
                    <Mic className="h-4 w-4 text-green-500" />
                    <span className="text-sm text-muted-foreground">Mic active</span>
                  </>
                ) : (
                  <>
                    <MicOff className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Bob talking...</span>
                  </>
                )}
              </div>
              {!showDebug && (
                <button 
                  onClick={() => setShowDebug(true)}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <Bug className="h-3 w-3" /> Debug
                </button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
