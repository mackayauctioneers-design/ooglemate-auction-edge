import { useState, useCallback, useRef, useEffect } from "react";

interface UseSpeechToTextOptions {
  onResult?: (transcript: string) => void;
  onInterim?: (transcript: string) => void;
  lang?: string;
  continuous?: boolean;
  silenceTimeoutMs?: number;
}

/**
 * Web Speech API wrapper with:
 *  - interim transcript preview
 *  - optional continuous listening with auto-restart on `onend`
 *  - silent restart on `no-speech` error in continuous mode
 */
export function useSpeechToText({
  onResult,
  onInterim,
  lang = "en-AU",
  continuous = false,
  silenceTimeoutMs = 2000,
}: UseSpeechToTextOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");

  const recognitionRef = useRef<any>(null);
  const shouldRestartRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest callbacks in refs so the recognition handlers always see fresh values
  const onResultRef = useRef(onResult);
  const onInterimRef = useRef(onInterim);
  useEffect(() => {
    onResultRef.current = onResult;
    onInterimRef.current = onInterim;
  }, [onResult, onInterim]);

  useEffect(() => {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    setIsSupported(!!SR);
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    shouldRestartRef.current = false;
    clearSilenceTimer();
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
    recognitionRef.current = null;
    setIsListening(false);
    setInterimTranscript("");
  }, [clearSilenceTimer]);

  const start = useCallback(() => {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SR) return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* noop */
      }
    }

    const recognition = new SR();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = continuous;

    recognition.onresult = (event: any) => {
      clearSilenceTimer();
      let finalTranscript = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      if (interimText) {
        setInterimTranscript(interimText);
        onInterimRef.current?.(interimText);
      }

      if (finalTranscript.trim()) {
        setInterimTranscript("");
        onResultRef.current?.(finalTranscript.trim());

        if (continuous && shouldRestartRef.current) {
          // Reserve a silence window so we don't immediately fire again
          silenceTimerRef.current = setTimeout(() => {}, silenceTimeoutMs);
        }
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript("");

      if (shouldRestartRef.current && continuous) {
        setTimeout(() => {
          if (shouldRestartRef.current) {
            try {
              recognition.start();
              setIsListening(true);
            } catch (e) {
              console.warn("[STT] Auto-restart failed:", e);
              shouldRestartRef.current = false;
            }
          }
        }, 300);
      }
    };

    recognition.onerror = (event: any) => {
      console.warn("[STT] Error:", event.error);
      if (event.error === "no-speech" && continuous && shouldRestartRef.current) {
        // onend will fire and trigger the auto-restart path
        return;
      }
      if (event.error === "aborted") return;
      setIsListening(false);
      setInterimTranscript("");
    };

    recognitionRef.current = recognition;
    shouldRestartRef.current = continuous;

    try {
      recognition.start();
      setIsListening(true);
    } catch (e) {
      console.error("[STT] Failed to start:", e);
    }
  }, [lang, continuous, clearSilenceTimer, silenceTimeoutMs]);

  const toggle = useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      clearSilenceTimer();
      try {
        recognitionRef.current?.stop();
      } catch {
        /* noop */
      }
    };
  }, [clearSilenceTimer]);

  return {
    isListening,
    isSupported,
    interimTranscript,
    toggle,
    start,
    stop,
  };
}
