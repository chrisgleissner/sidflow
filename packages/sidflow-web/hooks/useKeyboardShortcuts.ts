import { useEffect, useCallback } from 'react';

export interface KeyboardShortcutHandlers {
  onPlayPause?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onVolumeUp?: () => void;
  onVolumeDown?: () => void;
  onMute?: () => void;
  onToggleFavorite?: () => void;
  onSearch?: () => void;
  onShowHelp?: () => void;
}

const SHORTCUTS_MAP: Record<string, keyof KeyboardShortcutHandlers> = {
  ' ': 'onPlayPause',
  'ArrowRight': 'onNext',
  'ArrowLeft': 'onPrevious',
  'ArrowUp': 'onVolumeUp',
  'ArrowDown': 'onVolumeDown',
  'm': 'onMute',
  'M': 'onMute',
  'f': 'onToggleFavorite',
  'F': 'onToggleFavorite',
  's': 'onSearch',
  'S': 'onSearch',
  '?': 'onShowHelp',
};

/**
 * Hook to handle global keyboard shortcuts for media playback
 * Shortcuts are disabled when user is typing in input fields
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers, enabled: boolean = true) {
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) {
      return;
    }

    // Don't trigger shortcuts when user is typing in input fields
    const target = event.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    const handlerKey = SHORTCUTS_MAP[event.key];
    if (!handlerKey) {
      return;
    }

    const handler = handlers[handlerKey];
    if (handler) {
      event.preventDefault();
      handler();
    }
  }, [handlers, enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown, enabled]);
}

/**
 * Get human-readable descriptions of all keyboard shortcuts
 */
export function getShortcutDescriptions(): Array<{ key: string; action: string; description: string }> {
  return [
    { key: 'Space', action: 'Play/Pause', description: 'Toggle playback' },
    { key: '→', action: 'Next', description: 'Skip to next track' },
    { key: '←', action: 'Previous', description: 'Go to previous track' },
    { key: '↑', action: 'Volume Up', description: 'Increase volume' },
    { key: '↓', action: 'Volume Down', description: 'Decrease volume' },
    { key: 'M', action: 'Mute', description: 'Toggle mute' },
    { key: 'F', action: 'Favorite', description: 'Add/remove from favorites' },
    { key: 'S', action: 'Search', description: 'Focus search bar' },
    { key: '?', action: 'Help', description: 'Show keyboard shortcuts' },
  ];
}
