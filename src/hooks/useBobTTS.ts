import { useCallback, useRef, useState } from 'react';

// Hook for Bob's Text-to-Speech
// Converts Bob's response to audio and auto-plays it
// Handles iOS Safari autoplay by requiring user interaction context

export function useBobTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  // Clean up any existing audio
  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      URL.revokeObjectURL(audioRef.current.src);
      audioRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  // Speak the given text
  // IMPORTANT: Call this inside a user interaction (click/tap) for iOS autoplay
  const speak = useCallback(async (text: string): Promise<void> => {
    if (!text.trim()) return;
    
    // Stop any existing playback
    stopSpeaking();
    setIsLoading(true);

    try {
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
        throw new Error(`TTS request failed: ${response.status}`);
      }

      // Get audio as blob
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Create and play audio
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      
      audio.onplay = () => setIsSpeaking(true);
      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };
      audio.onerror = (e) => {
        console.error("Audio playback error:", e);
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
      };

      // Auto-play (works if called within user gesture context)
      await audio.play();
    } catch (error) {
      console.error("TTS error:", error);
      setIsSpeaking(false);
    } finally {
      setIsLoading(false);
    }
  }, [stopSpeaking]);

  return {
    speak,
    stopSpeaking,
    isSpeaking,
    isLoading,
  };
}
