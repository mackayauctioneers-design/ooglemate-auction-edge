import { useState, useCallback, useRef, useEffect } from "react";
import { useSpeechToText } from "./useSpeechToText";
import { useBobTTS } from "./useBobTTS";

export type VoiceAgentMode = "off" | "push-to-talk" | "agent";
export type VoiceAgentState = "idle" | "listening" | "processing" | "speaking" | "error";

interface UseBobVoiceAgentOptions {
  /** Send a user message into the chat pipeline (BobContext.sendMessage). */
  sendMessage: (text: string) => Promise<void>;
  /** True while bob-chat is streaming a response. */
  isStreaming: boolean;
  /** The latest assistant message text (used to trigger TTS). */
  latestAssistantMessage: string | null;
  /** ID of the latest assistant message — used to dedupe TTS playback. */
  latestAssistantMessageId?: string | null;
  /** Optional state-change observer. */
  onStateChange?: (state: VoiceAgentState) => void;
}

/**
 * Voice loop orchestrator for Bob.
 *
 *   user speaks  →  STT final transcript
 *                →  sendMessage()
 *                →  bob-chat streams reply
 *                →  TTS speaks the reply
 *                →  in `agent` mode, STT auto-restarts
 */
export function useBobVoiceAgent({
  sendMessage,
  isStreaming,
  latestAssistantMessage,
  latestAssistantMessageId,
  onStateChange,
}: UseBobVoiceAgentOptions) {
  const [mode, setMode] = useState<VoiceAgentMode>("off");
  const [state, setState] = useState<VoiceAgentState>("idle");
  const [lastSpokenMessageId, setLastSpokenMessageId] = useState<string>("");
  const [interimText, setInterimText] = useState("");

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const stateRef = useRef(state);
  stateRef.current = state;

  const updateState = useCallback(
    (newState: VoiceAgentState) => {
      setState(newState);
      stateRef.current = newState;
      onStateChange?.(newState);
    },
    [onStateChange],
  );

  // --- TTS ---
  const handleSpeakingEnd = useCallback(() => {
    // After Bob finishes talking, in agent mode go back to listening.
    if (modeRef.current === "agent") {
      updateState("listening");
      // start() is stable from useSpeechToText
      setTimeout(() => {
        if (modeRef.current === "agent") {
          sttStartRef.current?.();
        }
      }, 350);
    } else {
      updateState("idle");
    }
  }, [updateState]);

  const { speak, stopSpeaking, isSpeaking } = useBobTTS({
    onSpeakingEnd: handleSpeakingEnd,
  });

  // --- STT ---
  const handleFinalTranscript = useCallback(
    (transcript: string) => {
      setInterimText("");
      if (!transcript.trim()) return;
      updateState("processing");
      void sendMessage(transcript);
    },
    [sendMessage, updateState],
  );

  const handleInterim = useCallback((text: string) => {
    setInterimText(text);
  }, []);

  const {
    isListening,
    isSupported: sttSupported,
    start: sttStart,
    stop: sttStop,
    interimTranscript,
  } = useSpeechToText({
    onResult: handleFinalTranscript,
    onInterim: handleInterim,
    lang: "en-AU",
    continuous: mode === "agent",
  });

  // Hold a ref so handleSpeakingEnd (defined before the hook) can reach start()
  const sttStartRef = useRef<typeof sttStart | null>(null);
  useEffect(() => {
    sttStartRef.current = sttStart;
  }, [sttStart]);

  // Sync external state → derived voice state
  useEffect(() => {
    if (isSpeaking) updateState("speaking");
    else if (isStreaming) updateState("processing");
    else if (isListening) updateState("listening");
    else if (modeRef.current === "off") updateState("idle");
  }, [isSpeaking, isStreaming, isListening, updateState]);

  // Auto-speak whenever a NEW assistant message finishes streaming
  useEffect(() => {
    if (isStreaming) return;
    if (modeRef.current === "off") return;
    if (!latestAssistantMessage) return;

    const id = latestAssistantMessageId || latestAssistantMessage.slice(0, 64);
    if (id === lastSpokenMessageId) return;

    setLastSpokenMessageId(id);

    // Stop listening while Bob talks to prevent feedback
    sttStop();

    const text =
      latestAssistantMessage.length > 600
        ? latestAssistantMessage.slice(0, 600) + "…"
        : latestAssistantMessage;

    void speak(text);
  }, [
    isStreaming,
    latestAssistantMessage,
    latestAssistantMessageId,
    lastSpokenMessageId,
    speak,
    sttStop,
  ]);

  // --- Public controls ---
  const startAgentMode = useCallback(() => {
    setMode("agent");
    modeRef.current = "agent";
    updateState("listening");
    setTimeout(() => sttStart(), 100);
  }, [sttStart, updateState]);

  const endAgentMode = useCallback(() => {
    setMode("off");
    modeRef.current = "off";
    sttStop();
    stopSpeaking();
    setInterimText("");
    updateState("idle");
  }, [sttStop, stopSpeaking, updateState]);

  const togglePushToTalk = useCallback(() => {
    if (isListening) {
      sttStop();
      if (modeRef.current === "push-to-talk") {
        setMode("off");
        modeRef.current = "off";
        updateState("idle");
      }
    } else {
      setMode("push-to-talk");
      modeRef.current = "push-to-talk";
      sttStart();
      updateState("listening");
    }
  }, [isListening, sttStart, sttStop, updateState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sttStop();
      stopSpeaking();
    };
  }, [sttStop, stopSpeaking]);

  return {
    mode,
    state,
    interimText: interimText || interimTranscript,
    sttSupported,
    isListening,
    isSpeaking,
    startAgentMode,
    endAgentMode,
    togglePushToTalk,
    stopSpeaking,
  };
}
