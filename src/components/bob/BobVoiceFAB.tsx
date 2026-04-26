import { Mic, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import bobAvatarImg from "@/assets/bob-avatar.png";
import type { VoiceAgentState } from "@/hooks/useBobVoiceAgent";

interface BobVoiceFABProps {
  voiceState: VoiceAgentState;
  sttSupported: boolean;
  isListening: boolean;
  onOpenPanel: () => void;
  onPushToTalk: () => void;
  onStartAgent: () => void;
}

/**
 * Vertically-stacked floating action buttons:
 *   ┌─────────────┐
 *   │   Phone     │  hands-free agent mode
 *   │   Mic       │  push-to-talk
 *   │   Bob       │  open chat panel
 *   └─────────────┘
 */
export function BobVoiceFAB({
  voiceState,
  sttSupported,
  isListening,
  onOpenPanel,
  onPushToTalk,
  onStartAgent,
}: BobVoiceFABProps) {
  return (
    <div className="fixed top-1/2 -translate-y-1/2 right-4 z-50 flex flex-col items-center gap-2">
      {sttSupported && (
        <button
          onClick={onStartAgent}
          className={cn(
            "relative w-11 h-11 rounded-full shadow-lg flex items-center justify-center",
            "bg-green-600 text-white hover:scale-105 active:scale-95 transition-all duration-200",
            "border-2 border-background",
          )}
          aria-label="Start hands-free conversation"
          title="Hands-free with Bob"
        >
          <Phone className="h-4 w-4" />
        </button>
      )}

      {sttSupported && (
        <button
          onClick={onPushToTalk}
          className={cn(
            "relative w-11 h-11 rounded-full shadow-lg flex items-center justify-center",
            "transition-all duration-200 hover:scale-105 active:scale-95",
            "border-2 border-background",
            isListening
              ? "bg-red-500 text-white"
              : "bg-card text-foreground hover:bg-accent",
          )}
          aria-label={isListening ? "Stop listening" : "Push to talk"}
          title={isListening ? "Stop listening" : "Push to talk"}
        >
          {isListening && (
            <>
              <span className="absolute inset-0 rounded-full bg-red-500/40 animate-ping" />
              <span className="absolute inset-[-3px] rounded-full border-2 border-red-500/30 animate-pulse" />
            </>
          )}
          <Mic className="h-4 w-4 relative z-10" />
        </button>
      )}

      <button
        onClick={onOpenPanel}
        className={cn(
          "relative w-14 h-14 rounded-full shadow-lg overflow-hidden",
          "hover:scale-105 active:scale-95 transition-all duration-200",
          "border-2 border-background ring-2 ring-foreground/10",
          voiceState === "speaking" && "ring-green-500/60",
          voiceState === "processing" && "ring-amber-500/60",
        )}
        aria-label="Open Bob"
      >
        <img
          src={bobAvatarImg}
          alt="Bob"
          className="w-full h-full object-cover"
        />
      </button>
    </div>
  );
}
