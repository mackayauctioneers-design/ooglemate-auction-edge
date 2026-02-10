import { useState, useCallback, useRef, useEffect } from "react";

const MUTE_KEY = "caroogle-ai-summary-muted";

export function useSpokenSummary() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(() => {
    try { return localStorage.getItem(MUTE_KEY) === "true"; } catch { return false; }
  });
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  const speak = useCallback((text: string) => {
    if (!text || isMuted) return;
    if (!window.speechSynthesis) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Try to find an Australian English voice
    const voices = window.speechSynthesis.getVoices();
    const auVoice = voices.find(v => v.lang === "en-AU") 
      || voices.find(v => v.lang.startsWith("en-") && v.name.toLowerCase().includes("australia"))
      || voices.find(v => v.lang.startsWith("en-"));
    if (auVoice) utterance.voice = auVoice;
    utterance.lang = "en-AU";

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [isMuted]);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      try { localStorage.setItem(MUTE_KEY, String(next)); } catch {}
      if (next) window.speechSynthesis?.cancel();
      return next;
    });
  }, []);

  return { speak, stop, isSpeaking, isMuted, toggleMute };
}
