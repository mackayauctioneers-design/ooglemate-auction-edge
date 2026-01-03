import { useCallback, useRef, useState } from 'react';

// Debug state exposed to UI
export interface TTSDebugInfo {
  requestSent: boolean;
  responseBytes: number | null;
  audioSrcSet: boolean;
  playResult: string | null;
}

// Hook for Bob's Text-to-Speech with iOS audio unlock
export function useBobTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [debugInfo, setDebugInfo] = useState<TTSDebugInfo>({
    requestSent: false,
    responseBytes: null,
    audioSrcSet: false,
    playResult: null,
  });
  const [pendingAudioUrl, setPendingAudioUrl] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Reset debug info
  const resetDebug = useCallback(() => {
    setDebugInfo({
      requestSent: false,
      responseBytes: null,
      audioSrcSet: false,
      playResult: null,
    });
    setPendingAudioUrl(null);
  }, []);

  // Clean up any existing audio
  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      if (audioRef.current.src) {
        URL.revokeObjectURL(audioRef.current.src);
      }
      audioRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  // Initialize AudioContext on user gesture (for iOS)
  const unlockAudio = useCallback(async (): Promise<boolean> => {
    try {
      // Create AudioContext if not exists
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      // Resume if suspended
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      // Create and play a tiny silent buffer to unlock audio
      const buffer = audioContextRef.current.createBuffer(1, 1, 22050);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      source.start(0);
      
      console.log("Audio unlocked via AudioContext");
      setAudioUnlocked(true);
      return true;
    } catch (error) {
      console.error("Failed to unlock audio:", error);
      return false;
    }
  }, []);

  // Play audio from URL (reusable for retry button)
  const playAudioFromUrl = useCallback(async (audioUrl: string): Promise<boolean> => {
    try {
      const audio = new Audio();
      audio.setAttribute('playsinline', 'true');
      audio.muted = false;
      audio.volume = 1.0;
      audio.preload = 'auto';
      
      audioRef.current = audio;
      
      audio.onplay = () => {
        console.log("Audio playback started");
        setIsSpeaking(true);
        setDebugInfo(prev => ({ ...prev, playResult: 'playing' }));
      };
      
      audio.onended = () => {
        console.log("Audio playback ended");
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
        setPendingAudioUrl(null);
      };
      
      audio.onerror = (e) => {
        const errorMsg = `Audio error: ${audio.error?.message || 'unknown'}`;
        console.error("Audio playback error:", e, audio.error);
        setIsSpeaking(false);
        setDebugInfo(prev => ({ ...prev, playResult: errorMsg }));
        audioRef.current = null;
      };

      audio.src = audioUrl;
      setDebugInfo(prev => ({ ...prev, audioSrcSet: true }));
      
      // Try to play
      await audio.play();
      setAudioUnlocked(true);
      return true;
    } catch (error: any) {
      const errorMsg = error.name === 'NotAllowedError' 
        ? 'Blocked: tap "Play voice" button'
        : `Play failed: ${error.message}`;
      console.error("Play error:", error);
      setDebugInfo(prev => ({ ...prev, playResult: errorMsg }));
      setIsSpeaking(false);
      // Keep URL for retry
      setPendingAudioUrl(audioUrl);
      return false;
    }
  }, []);

  // Retry playing pending audio (called from UI button)
  const retryPlay = useCallback(async (): Promise<boolean> => {
    if (!pendingAudioUrl) {
      console.log("No pending audio to retry");
      return false;
    }
    
    // Unlock audio first
    await unlockAudio();
    return playAudioFromUrl(pendingAudioUrl);
  }, [pendingAudioUrl, unlockAudio, playAudioFromUrl]);

  // Speak the given text
  const speak = useCallback(async (text: string): Promise<boolean> => {
    if (!text.trim()) return false;
    
    stopSpeaking();
    resetDebug();
    setIsLoading(true);
    setDebugInfo(prev => ({ ...prev, requestSent: true }));

    try {
      console.log("Sending TTS request for:", text.substring(0, 50) + "...");
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bob-tts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ text }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`TTS request failed: ${response.status} - ${errorText}`);
      }

      const audioBlob = await response.blob();
      const blobSize = audioBlob.size;
      console.log("TTS response received, bytes:", blobSize);
      setDebugInfo(prev => ({ ...prev, responseBytes: blobSize }));
      
      if (blobSize < 100) {
        throw new Error(`Audio too small: ${blobSize} bytes`);
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      setPendingAudioUrl(audioUrl);
      setIsLoading(false);
      
      // Try to auto-play
      const played = await playAudioFromUrl(audioUrl);
      return played;
      
    } catch (error: any) {
      console.error("TTS error:", error);
      setDebugInfo(prev => ({ ...prev, playResult: `TTS error: ${error.message}` }));
      setIsSpeaking(false);
      setIsLoading(false);
      return false;
    }
  }, [stopSpeaking, resetDebug, playAudioFromUrl]);

  // Test sound function - plays a short test phrase
  const testSound = useCallback(async (): Promise<boolean> => {
    // First unlock audio
    await unlockAudio();
    // Then speak test phrase
    return speak("Yeah mate, Bob here.");
  }, [unlockAudio, speak]);

  return {
    speak,
    stopSpeaking,
    testSound,
    retryPlay,
    unlockAudio,
    isSpeaking,
    isLoading,
    audioUnlocked,
    debugInfo,
    hasPendingAudio: !!pendingAudioUrl,
  };
}
