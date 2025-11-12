/**
 * Lightweight telemetry dashboard for monitoring audio playback health.
 * Displays aggregate metrics without heavy processing or rendering.
 * 
 * Shows:
 * - Underrun count and rate
 * - Zero-byte frames
 * - Timing drift (avg and max)
 * - Buffer occupancy (min/max)
 * - Audio context state changes
 */

'use client';

import { useEffect, useState } from 'react';
import type { TelemetryData } from '@/lib/audio/worklet-player';

interface TelemetryDashboardProps {
  telemetry: TelemetryData | null;
  className?: string;
}

export function TelemetryDashboard({ telemetry, className = '' }: TelemetryDashboardProps) {
  const [visible, setVisible] = useState(false);

  // Only show in development or when explicitly enabled
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const showTelemetry = 
        process.env.NODE_ENV === 'development' ||
        localStorage.getItem('showTelemetry') === 'true';
      setVisible(showTelemetry);
    }
  }, []);

  if (!visible || !telemetry) {
    return null;
  }

  const underrunRate = telemetry.framesConsumed > 0
    ? (telemetry.underruns / telemetry.framesConsumed * 100).toFixed(4)
    : '0.0000';

  const zeroByteRate = telemetry.framesConsumed > 0
    ? (telemetry.zeroByteFrames / telemetry.framesConsumed * 100).toFixed(4)
    : '0.0000';

  // Categorize health status
  const hasIssues = telemetry.underruns > 0 || telemetry.missedQuanta > 0;
  const hasDrift = telemetry.maxDriftMs > 1.0;

  return (
    <div className={`fixed bottom-4 right-4 bg-black/80 text-white text-xs p-3 rounded-lg border border-gray-700 max-w-xs ${className}`}>
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-semibold">Audio Telemetry</h3>
        <button
          onClick={() => {
            localStorage.setItem('showTelemetry', 'false');
            setVisible(false);
          }}
          className="text-gray-400 hover:text-white"
        >
          ✕
        </button>
      </div>
      
      <div className="space-y-1">
        {/* Overall health indicator */}
        <div className={`font-semibold ${hasIssues ? 'text-red-400' : 'text-green-400'}`}>
          Status: {hasIssues ? '⚠ Issues Detected' : '✓ Healthy'}
        </div>

        {/* Underruns */}
        <div className={telemetry.underruns > 0 ? 'text-red-400' : ''}>
          Underruns: {telemetry.underruns} ({underrunRate}%)
        </div>

        {/* Zero-byte frames */}
        <div className={telemetry.zeroByteFrames > 100 ? 'text-yellow-400' : ''}>
          Zero-byte frames: {telemetry.zeroByteFrames} ({zeroByteRate}%)
        </div>

        {/* Missed quanta */}
        {telemetry.missedQuanta > 0 && (
          <div className="text-red-400">
            Missed quanta: {telemetry.missedQuanta}
          </div>
        )}

        {/* Timing drift */}
        <div className={hasDrift ? 'text-yellow-400' : ''}>
          Drift: avg {telemetry.avgDriftMs.toFixed(2)}ms, max {telemetry.maxDriftMs.toFixed(2)}ms
        </div>

        {/* Buffer occupancy */}
        <div>
          Buffer: min {telemetry.minOccupancy}, max {telemetry.maxOccupancy} frames
        </div>

        {/* Frames */}
        <div>
          Consumed: {telemetry.framesConsumed}, Produced: {telemetry.framesProduced}
        </div>

        {/* Backpressure */}
        {telemetry.backpressureStalls > 0 && (
          <div className="text-yellow-400">
            Backpressure stalls: {telemetry.backpressureStalls}
          </div>
        )}

        {/* Context state changes */}
        {(telemetry.contextSuspendCount > 0 || telemetry.contextResumeCount > 0) && (
          <div className="text-gray-400">
            Context: {telemetry.contextSuspendCount} suspend, {telemetry.contextResumeCount} resume
          </div>
        )}
      </div>

      <div className="mt-2 pt-2 border-t border-gray-700 text-gray-400">
        Toggle: localStorage.setItem('showTelemetry', 'true')
      </div>
    </div>
  );
}
