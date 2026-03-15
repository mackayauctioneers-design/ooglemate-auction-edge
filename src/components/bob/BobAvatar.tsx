import { cn } from '@/lib/utils';
import bobAvatarImg from '@/assets/bob-avatar.png';

interface BobAvatarProps {
  size?: 'sm' | 'md' | 'lg';
  isThinking?: boolean;
  isSpeaking?: boolean;
  className?: string;
}

const sizes = {
  sm: 'w-9 h-9',
  md: 'w-14 h-14',
  lg: 'w-20 h-20',
};

export function BobAvatar({ size = 'md', isThinking, isSpeaking, className }: BobAvatarProps) {
  return (
    <div className={cn("relative flex-shrink-0", className)}>
      <div className={cn(
        "rounded-full overflow-hidden border-2 transition-all duration-300",
        sizes[size],
        isSpeaking ? "border-foreground shadow-lg" : isThinking ? "border-muted-foreground/50" : "border-border"
      )}>
        <img
          src={bobAvatarImg}
          alt="Bob"
          className={cn(
            "w-full h-full object-cover",
            isThinking && "animate-pulse-soft"
          )}
        />
      </div>
      {/* Status ring */}
      {(isSpeaking || isThinking) && (
        <span className={cn(
          "absolute inset-[-3px] rounded-full border-2 animate-ping",
          isSpeaking ? "border-foreground/30" : "border-muted-foreground/20"
        )} style={{ animationDuration: '2s' }} />
      )}
      {/* Online dot */}
      <span className={cn(
        "absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background",
        isSpeaking ? "bg-green-500" : isThinking ? "bg-amber-500 animate-pulse" : "bg-green-500"
      )} />
    </div>
  );
}
