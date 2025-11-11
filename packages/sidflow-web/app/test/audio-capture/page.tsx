'use client';

import { useEffect, useState } from 'react';
import { SidflowPlayer } from '@/lib/player/sidflow-player';

// Extend Window interface for test properties
declare global {
  interface Window {
    __testPlayer?: SidflowPlayer;
    __testPlayerReady?: boolean;
  }
}

/**
 * Test page for audio capture in E2E tests.
 * This page exposes the SidflowPlayer for testing purposes.
 */
export default function AudioCapturePage() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Create a player and expose it globally for tests
    const player = new SidflowPlayer();
    window.__testPlayer = player;
    (window as unknown as { __sidflowPlayer?: SidflowPlayer }).__sidflowPlayer = player;
    window.__testPlayerReady = true;
    
    // Update state to trigger re-render
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsReady(true);

    return () => {
      if (window.__testPlayer === player) {
        delete window.__testPlayer;
      }
      const globalWindow = window as unknown as { __sidflowPlayer?: SidflowPlayer };
      if (globalWindow.__sidflowPlayer === player) {
        delete globalWindow.__sidflowPlayer;
      }
      player.destroy();
      window.__testPlayerReady = false;
    };
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Audio Capture Test Page</h1>
      <p className="text-gray-600">Status: {isReady ? 'Ready' : 'Initializing...'}</p>
      <p className="text-sm text-gray-500 mt-4">
        This page is used for E2E testing. The player is available at window.__testPlayer.
      </p>
    </div>
  );
}
