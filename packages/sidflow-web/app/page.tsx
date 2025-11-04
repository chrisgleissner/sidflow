'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusDisplay } from '@/components/StatusDisplay';
import { PlayTab } from '@/components/PlayTab';
import { RateTab } from '@/components/RateTab';
import { ClassifyTab } from '@/components/ClassifyTab';
import { FetchTab } from '@/components/FetchTab';
import { TrainTab } from '@/components/TrainTab';
import { WizardTab } from '@/components/WizardTab';
import { QueueView } from '@/components/QueueView';

interface QueueItem {
  path: string;
  timestamp: number;
}

export default function Home() {
  const [status, setStatus] = useState('');
  const [isError, setIsError] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeTab, setActiveTab] = useState('wizard');

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
    <div className="min-h-screen bg-background p-4 md:p-8">
      <main className="max-w-6xl mx-auto space-y-6">
        {/* Header with C64 aesthetic */}
        <div className="text-center space-y-2 py-6">
          <h1 className="text-5xl md:text-6xl font-bold petscii-text text-accent tracking-wider">
            ★ SIDFLOW ★
          </h1>
          <p className="text-lg text-foreground font-mono">
            » COMMODORE 64 MUSIC CONTROL PANEL «
          </p>
          <p className="text-sm text-muted-foreground">
            PLAY • RATE • CLASSIFY • TRAIN
          </p>
        </div>

        {/* Status Display */}
        {status && (
          <StatusDisplay status={status} isError={isError} onClear={clearStatus} />
        )}

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 gap-1 h-auto p-1 bg-card/50 border-2 border-border">
            <TabsTrigger 
              value="wizard" 
              className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground font-bold"
            >
              WIZARD
            </TabsTrigger>
            <TabsTrigger 
              value="play"
              className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground font-bold"
            >
              PLAY
            </TabsTrigger>
            <TabsTrigger 
              value="rate"
              className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground font-bold"
            >
              RATE
            </TabsTrigger>
            <TabsTrigger 
              value="classify"
              className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground font-bold"
            >
              CLASSIFY
            </TabsTrigger>
            <TabsTrigger 
              value="fetch"
              className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground font-bold"
            >
              FETCH
            </TabsTrigger>
            <TabsTrigger 
              value="train"
              className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground font-bold"
            >
              TRAIN
            </TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="wizard" className="mt-0">
              <WizardTab 
                onStatusChange={handleStatusChange}
                onSwitchTab={setActiveTab}
              />
            </TabsContent>

            <TabsContent value="play" className="mt-0">
              <PlayTab
                onStatusChange={handleStatusChange}
                onTrackPlayed={handleTrackPlayed}
              />
            </TabsContent>

            <TabsContent value="rate" className="mt-0">
              <RateTab onStatusChange={handleStatusChange} />
            </TabsContent>

            <TabsContent value="classify" className="mt-0">
              <ClassifyTab onStatusChange={handleStatusChange} />
            </TabsContent>

            <TabsContent value="fetch" className="mt-0">
              <FetchTab onStatusChange={handleStatusChange} />
            </TabsContent>

            <TabsContent value="train" className="mt-0">
              <TrainTab onStatusChange={handleStatusChange} />
            </TabsContent>
          </div>
        </Tabs>

        {/* Queue View */}
        {queue.length > 0 && <QueueView queue={queue} />}

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground py-4 font-mono">
          <p>═══════════════════════════════════════</p>
          <p>READY.</p>
          <p>═══════════════════════════════════════</p>
        </div>
      </main>
    </div>
  );
}
