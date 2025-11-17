'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { getShortcutDescriptions } from '@/hooks/useKeyboardShortcuts';
import { Keyboard } from 'lucide-react';

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsHelp({ open, onOpenChange }: KeyboardShortcutsHelpProps) {
  const shortcuts = getShortcutDescriptions();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Use these keyboard shortcuts to control playback
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-3">
            {shortcuts.map((shortcut) => (
              <div key={shortcut.key} className="contents">
                <div className="flex items-center">
                  <kbd className="inline-flex items-center justify-center rounded border border-border bg-muted px-2 py-1 text-sm font-semibold text-foreground shadow-sm">
                    {shortcut.key}
                  </kbd>
                </div>
                <div className="flex flex-col justify-center">
                  <div className="text-sm font-medium text-foreground">{shortcut.action}</div>
                  <div className="text-xs text-muted-foreground">{shortcut.description}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground pt-2 border-t">
            Tip: Shortcuts are disabled when typing in input fields
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
