/**
 * Hook to periodically fetch and track audio telemetry from the player.
 * Updates every few seconds to avoid excessive React re-renders.
 */

import { useEffect, useState } from 'react';
import type { TelemetryData } from '@/lib/audio/worklet-player';
import type { WorkletPlayer } from '@/lib/audio/worklet-player';

const TELEMETRY_UPDATE_INTERVAL_MS = 3000; // Update every 3 seconds

export function useTelemetry(player: WorkletPlayer | null): TelemetryData | null {
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);

  useEffect(() => {
    if (!player) {
      setTelemetry(null);
      return;
    }

    // Initial fetch
    setTelemetry(player.getTelemetry());

    // Periodic updates
    const interval = setInterval(() => {
      setTelemetry(player.getTelemetry());
    }, TELEMETRY_UPDATE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [player]);

  return telemetry;
}
