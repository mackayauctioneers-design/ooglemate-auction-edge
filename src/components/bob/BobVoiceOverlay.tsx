import { PhoneOff, Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { BobAvatar } from "./BobAvatar";
import { BobWaveform } from "./BobWaveform";
import type { VoiceAgentState } from "@/hooks/useBobVoiceAgent";

interface BobVoiceOverlayProps {
  isOpen: boolean;
  state: VoiceAgentState;
  interimText: string;
  lastBobMessage: string | null;
  dealerName: string;
  onEndCall: () => void;
  onMuteToggle?: () => void;
  isMuted?: boolean;
}

const STATE_LABEL: Record<VoiceAgentState, string> = {
  idle: "Ready",
  listening: "Listening…",
  processing: "Bob is thinking…",
  speaking: "Bob is speaking…",
  error: "Something went wrong",
};

const STATE_COLOR: Record<VoiceAgentState, string> = {
  idle: "text-muted-foreground",
  listening: "text-red-500",
  processing: "text-amber-500",
  speaking: "text-green-500",
  error: "text-destructive",
};

export function BobVoiceOverlay({
  isOpen,
  state,
  interimText,
  lastBobMessage,
  dealerName,
  onEndCall,
  onMuteToggle,
  isMuted = false,
}: BobVoiceOverlayProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-background/95 backdrop-blur-xl animate-fade-in p-6">
      {/* Header */}
      <div className="w-full text-center pt-6">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Hands-free with Bob
        </p>
        <p className="text-sm text-foreground/80 mt-1">{dealerName}</p>
      </div>

      {/* Center stage */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full">
        <div
          className={cn(
            "transition-all duration-300",
            state === "speaking" && "scale-110",
            state === "listening" && "scale-105",
          )}
        >
          <BobAvatar
            size="lg"
            isSpeaking={state === "speaking"}
            isThinking={state === "processing"}
          />
        </div>

        <div className="text-center space-y-2">
          <p className={cn("text-lg font-medium", STATE_COLOR[state])}>
            {STATE_LABEL[state]}
          </p>
        </div>

        {(state === "listening" || state === "speaking") && (
          <BobWaveform active bars={7} />
        )}

        {/* Interim transcript while listening */}
        {interimText && state === "listening" && (
          <div className="max-w-md text-center px-4">
            <p className="text-base text-foreground/80 italic animate-pulse">
              "{interimText}"
            </p>
          </div>
        )}

        {/* Last Bob reply while speaking */}
        {lastBobMessage && state === "speaking" && (
          <div className="max-w-md text-center px-4">
            <p className="text-sm text-foreground/70 leading-relaxed line-clamp-4">
              {lastBobMessage}
            </p>
          </div>
        )}
      </div>

      {/* Footer controls */}
      <div className="flex items-center justify-center gap-6 pb-8">
        {onMuteToggle && (
          <button
            onClick={onMuteToggle}
            className={cn(
              "w-14 h-14 rounded-full border border-border flex items-center justify-center",
              "bg-card hover:bg-accent transition-colors",
              isMuted && "bg-muted text-muted-foreground",
            )}
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </button>
        )}

        <button
          onClick={onEndCall}
          className={cn(
            "w-16 h-16 rounded-full bg-destructive text-destructive-foreground",
            "flex items-center justify-center shadow-lg shadow-destructive/30",
            "hover:scale-105 active:scale-95 transition-transform",
          )}
          aria-label="End call"
        >
          <PhoneOff className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
