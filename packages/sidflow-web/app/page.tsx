'use client';

import { useState } from 'react';
import { PlayControls } from '@/components/PlayControls';
import { RatingPanel } from '@/components/RatingPanel';
import { StatusDisplay } from '@/components/StatusDisplay';
import { QueueView } from '@/components/QueueView';

interface QueueItem {
  path: string;
  timestamp: number;
}

export default function Home() {
  const [status, setStatus] = useState('');
  const [isError, setIsError] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const handleStatusChange = (newStatus: string, error = false) => {
    setStatus(newStatus);
    setIsError(error);
  };

  const handleTrackPlayed = (sidPath: string) => {
    setQueue((prev) => [
      { path: sidPath, timestamp: Date.now() },
      ...prev.slice(0, 9), // Keep last 10 tracks
    ]);
  };

  const clearStatus = () => {
    setStatus('');
    setIsError(false);
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <main className="max-w-7xl mx-auto space-y-8">
        <div>
          <h1 className="text-4xl font-bold mb-2">SIDFlow Control Panel</h1>
          <p className="text-muted-foreground">
            Local web interface for orchestrating SID playback, rating, and classification
          </p>
        </div>

        <StatusDisplay status={status} isError={isError} onClear={clearStatus} />

        <div className="grid gap-6 md:grid-cols-2">
          <PlayControls
            onStatusChange={handleStatusChange}
            onTrackPlayed={handleTrackPlayed}
          />
          <RatingPanel onStatusChange={handleStatusChange} />
        </div>

        <QueueView queue={queue} />
      </main>
    </div>
  );
}
