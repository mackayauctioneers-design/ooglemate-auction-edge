import { Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BobVoiceButtonProps {
  isListening: boolean;
  isSupported: boolean;
  onClick: () => void;
  size?: 'sm' | 'lg';
  className?: string;
}

export function BobVoiceButton({ isListening, isSupported, onClick, size = 'sm', className }: BobVoiceButtonProps) {
  if (!isSupported) return null;

  const isSm = size === 'sm';

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center justify-center rounded-full transition-all duration-200",
        isSm ? "w-10 h-10" : "w-14 h-14",
        isListening
          ? "bg-red-500 text-white shadow-lg shadow-red-500/30"
          : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
        className
      )}
      aria-label={isListening ? "Stop listening" : "Start voice input"}
    >
      {/* Pulse rings when listening */}
      {isListening && (
        <>
          <span className="absolute inset-0 rounded-full bg-red-500/40 animate-ping" />
          <span className="absolute inset-[-4px] rounded-full border-2 border-red-500/30 animate-pulse" />
        </>
      )}
      {isListening ? (
        <MicOff className={cn(isSm ? "h-4 w-4" : "h-6 w-6", "relative z-10")} />
      ) : (
        <Mic className={cn(isSm ? "h-4 w-4" : "h-6 w-6", "relative z-10")} />
      )}
    </button>
  );
}
