import { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Loader2, X, Volume2, Mic, MicOff, Play, Bug } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useBobTTS } from '@/hooks/useBobTTS';

// ============================================================================
// BOB: Voice-first AI using OpenAI Realtime API (WebRTC)
// ============================================================================

interface BobAvatarProps {
  dealerName?: string;
}

export function BobAvatar({ dealerName }: BobAvatarProps) {
  // Connection state
  const [isOpen, setIsOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showDebug, setShowDebug] = useState(true); // Show debug by default for troubleshooting
  
  // Transcripts
  const [userTranscript, setUserTranscript] = useState('');
  const [bobTranscript, setBobTranscript] = useState('');
  const [conversationHistory, setConversationHistory] = useState<Array<{role: string, text: string, audioFailed?: boolean}>>([]);
  
  // TTS Hook
  const { 
    speak, 
    testSound, 
    retryPlay, 
    unlockAudio,
    isSpeaking: ttsSpeaking, 
    isLoading: ttsLoading,
    audioUnlocked,
    debugInfo,
    hasPendingAudio,
  } = useBobTTS();
  
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
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    
    try {
      // Get ephemeral token from edge function
      const tokenResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bob-realtime-token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        }
      );

      if (!tokenResponse.ok) {
        throw new Error('Failed to get session token');
      }

      const data = await tokenResponse.json();
      
      if (!data.client_secret?.value) {
        throw new Error('No ephemeral token received');
      }

      const EPHEMERAL_KEY = data.client_secret.value;
      console.log("Got ephemeral token, establishing WebRTC connection...");

      // Create peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Create audio element for remote audio
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioElRef.current = audioEl;

      // Set up remote audio
      pc.ontrack = (e) => {
        console.log("Received remote track");
        audioEl.srcObject = e.streams[0];
      };

      // Get local audio and add to peer connection
      const localStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });
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
      console.log("WebRTC connection established");

    } catch (error) {
      console.error("Connection error:", error);
      toast.error("Couldn't connect to Bob");
      disconnect();
      setIsConnecting(false);
    }
  }, [disconnect]);

  const handleRealtimeEvent = useCallback((event: any) => {
    console.log("Realtime event:", event.type);

    switch (event.type) {
      case 'session.created':
        console.log("Session created");
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
          // Add to history and try TTS
          setConversationHistory(prev => [...prev, { role: 'assistant', text: bobText }]);
          // Speak via TTS
          speak(bobText);
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
  }, [bobTranscript, speak]);

  const handleOpenBob = useCallback(async () => {
    setIsOpen(true);
    setTimeout(() => connect(), 200);
  }, [connect]);

  const handleClose = useCallback(() => {
    disconnect();
    setUserTranscript('');
    setBobTranscript('');
    setConversationHistory([]);
    setIsOpen(false);
  }, [disconnect]);

  const handleTestSound = useCallback(async () => {
    console.log("Test sound button clicked");
    const success = await testSound();
    if (success) {
      toast.success("Audio working!");
    }
  }, [testSound]);

  const handleRetryPlay = useCallback(async () => {
    console.log("Retry play clicked");
    await retryPlay();
  }, [retryPlay]);

  return (
    <>
      {/* Floating Bob Avatar */}
      <button
        onClick={handleOpenBob}
        disabled={isConnecting}
        className={cn(
          "fixed bottom-6 right-6 z-50 w-16 h-16 rounded-full shadow-xl",
          "flex items-center justify-center transition-all duration-200",
          "bg-gradient-to-br from-primary to-primary/80",
          "hover:scale-105 active:scale-95",
          isConnecting && "opacity-60"
        )}
        aria-label="Talk to Bob"
      >
        {isConnecting ? (
          <Loader2 className="h-7 w-7 animate-spin text-primary-foreground" />
        ) : (
          <span className="text-3xl">👨‍🔧</span>
        )}
      </button>
      <span className="fixed bottom-2 right-8 z-50 text-xs font-medium text-muted-foreground">
        Bob
      </span>

      {/* Conversation Dialog */}
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <DialogContent className="max-w-sm p-0 overflow-hidden gap-0">
          {/* Header */}
          <div className="bg-gradient-to-br from-primary to-primary/80 p-6 text-center text-primary-foreground relative">
            <div className="text-5xl mb-2">👨‍🔧</div>
            <p className="font-semibold text-lg">Bob</p>
            
            {/* Audio status badge */}
            <div className={cn(
              "absolute top-3 left-3 px-2 py-1 rounded-full text-xs font-medium",
              audioUnlocked ? "bg-green-500/20 text-green-200" : "bg-yellow-500/20 text-yellow-200"
            )}>
              {audioUnlocked ? "🔊 Audio OK" : "🔇 Tap Test"}
            </div>
            
            {/* Status indicators */}
            <div className="flex items-center justify-center gap-1.5 mt-2 min-h-[24px]">
              {isConnecting && (
                <p className="text-sm opacity-90 flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Connecting...
                </p>
              )}
              {isConnected && (ttsSpeaking || isSpeaking) && (
                <p className="text-sm opacity-90 flex items-center gap-1.5">
                  <Volume2 className="h-4 w-4 animate-pulse" />
                  Speaking...
                </p>
              )}
              {isConnected && isListening && !isSpeaking && !ttsSpeaking && (
                <p className="text-sm opacity-90 flex items-center gap-1.5 animate-pulse">
                  <Mic className="h-4 w-4" />
                  Listening...
                </p>
              )}
              {isConnected && !isListening && !isSpeaking && !ttsSpeaking && (
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

          {/* Test Sound Button - Always visible until audio unlocked */}
          {!audioUnlocked && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border-b">
              <Button 
                onClick={handleTestSound}
                disabled={ttsLoading}
                className="w-full"
                variant="outline"
              >
                {ttsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Volume2 className="h-4 w-4 mr-2" />
                )}
                Test Sound (Tap to unlock audio)
              </Button>
            </div>
          )}

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
              <div>TTS sent: {debugInfo.requestSent ? '✅' : '❌'}</div>
              <div>Response bytes: {debugInfo.responseBytes ?? '—'}</div>
              <div>Audio src set: {debugInfo.audioSrcSet ? '✅' : '❌'}</div>
              <div>Play result: {debugInfo.playResult ?? '—'}</div>
              <div>Audio unlocked: {audioUnlocked ? '✅' : '❌'}</div>
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

            {/* Retry play button if autoplay failed */}
            {hasPendingAudio && !ttsSpeaking && (
              <div className="flex justify-center">
                <Button
                  onClick={handleRetryPlay}
                  size="sm"
                  variant="secondary"
                  className="gap-2"
                >
                  <Play className="h-4 w-4" />
                  Play Bob's voice
                </Button>
              </div>
            )}

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
