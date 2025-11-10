'use client';

import { useEffect, useState } from 'react';
import { SidflowPlayer } from '@/lib/player/sidflow-player';

/**
 * Test page for audio capture in E2E tests.
 * This page exposes the SidflowPlayer for testing purposes.
 */
export default function AudioCapturePage() {
  const [status, setStatus] = useState('Initializing...');

  useEffect(() => {
    // Create a player and expose it globally for tests
    const player = new SidflowPlayer();
    (window as any).__testPlayer = player;
    (window as any).__testPlayerReady = true;
    
    setStatus('Ready');
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Audio Capture Test Page</h1>
      <p className="text-gray-600">Status: {status}</p>
      <p className="text-sm text-gray-500 mt-4">
        This page is used for E2E testing. The player is available at window.__testPlayer.
      </p>
    </div>
  );
}
