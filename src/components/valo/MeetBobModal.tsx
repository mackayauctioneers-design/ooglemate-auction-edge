import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, MessageSquare, Camera, DollarSign, Check } from 'lucide-react';

const BOB_INTRO_KEY = 'ooglemate_bob_intro_seen';

interface MeetBobModalProps {
  forcedOpen?: boolean;
  onClose?: () => void;
}

export function MeetBobModal({ forcedOpen, onClose }: MeetBobModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const hasSeen = localStorage.getItem(BOB_INTRO_KEY);
    if (!hasSeen && !forcedOpen) {
      setIsOpen(true);
    }
    if (forcedOpen) {
      setIsOpen(true);
    }
  }, [forcedOpen]);

  const handleClose = () => {
    localStorage.setItem(BOB_INTRO_KEY, 'true');
    setIsOpen(false);
    onClose?.();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground">
              <Sparkles className="h-6 w-6" />
            </div>
            <DialogTitle className="text-xl">Meet Bob</DialogTitle>
          </div>
          <DialogDescription className="text-base">
            Your blunt, no-BS wholesale valuation mate.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <p className="text-sm">
              <strong>Bob</strong> is an experienced Australian auction knocker with 20+ years on the floor.
              He prices cars to <strong>buy them</strong> — not to bounce them.
            </p>
            <p className="text-sm text-muted-foreground">
              Married to Shaz. Loves the footy. Talks straight.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <MessageSquare className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Ask Bob anything</p>
                <p className="text-xs text-muted-foreground">
                  Describe a car in plain language. Bob parses it and gives you a wholesale buy range.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <DollarSign className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Wholesale-first pricing</p>
                <p className="text-xs text-muted-foreground">
                  Bob bases opinions on real sales data. Ranges, not exact numbers. Never hype.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Camera className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Send pics for human review</p>
                <p className="text-xs text-muted-foreground">
                  Not sure? Upload 4-5 photos and Bob's team will eyeball it and firm up the numbers.
                </p>
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="text-xs text-muted-foreground">
              <strong>Bob's rules:</strong> He never overcommits without data. He never says "guaranteed" or "easy money".
              If he can't price it to own, he says "Walk away".
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleClose} className="w-full gap-2">
            <Check className="h-4 w-4" />
            Got it, let's go
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
