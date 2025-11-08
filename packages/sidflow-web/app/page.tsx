'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusDisplay } from '@/components/StatusDisplay';
import { WizardTab } from '@/components/WizardTab';
import { PrefsTab } from '@/components/PrefsTab';
import { FetchTab } from '@/components/FetchTab';
import { RateTab } from '@/components/RateTab';
import { ClassifyTab } from '@/components/ClassifyTab';
import { TrainTab } from '@/components/TrainTab';
import { PlayTab } from '@/components/PlayTab';
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
    <div className="min-h-screen bg-background">
      <main className="max-w-7xl mx-auto">
        {/* Modern Compact Header */}
        <header className="bg-card border-b-4 border-border px-6 py-3 shadow-lg">
          <div className="flex items-center gap-4">
            <Image
              src="/logo-modern.svg"
              alt="SIDFlow"
              width={48}
              height={48}
              className="w-12 h-12"
              priority
              unoptimized
            />
            <div className="flex-1">
              <h1 className="text-xl font-bold text-foreground tracking-tight leading-tight">
                SIDFlow
              </h1>
              <p className="text-xs text-muted-foreground leading-tight">
                COMMODORE 64 MUSIC CONTROL
              </p>
            </div>
            <div className="hidden md:flex items-center gap-3 text-xs font-mono text-muted-foreground">
              <span className="px-2 py-1 bg-accent/20 rounded">PLAY</span>
              <span>•</span>
              <span className="px-2 py-1 bg-accent/20 rounded">RATE</span>
              <span>•</span>
              <span className="px-2 py-1 bg-accent/20 rounded">CLASSIFY</span>
              <span>•</span>
              <span className="px-2 py-1 bg-accent/20 rounded">TRAIN</span>
            </div>
          </div>
        </header>

        <div className="p-4 md:p-6 space-y-4">

          {/* Status Display */}
          {status && (
            <StatusDisplay status={status} isError={isError} onClear={clearStatus} />
          )}

          {/* Modern Tab Layout with Side Navigation for Wide Screens */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Sidebar Navigation for Large Screens / Scrollable Top Tabs for Mobile */}
              <TabsList className="flex flex-row lg:flex-col lg:w-48 justify-start gap-2 h-auto p-2 bg-card border-2 border-border overflow-x-auto lg:overflow-x-visible flex-nowrap lg:flex-wrap">
                <TabsTrigger 
                  value="wizard" 
                  className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground font-bold justify-start lg:w-full text-xs lg:text-sm py-2 whitespace-nowrap flex-shrink-0"
                >
                  🧙 WIZARD
                </TabsTrigger>
                <TabsTrigger 
                  value="prefs" 
                  className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground font-bold justify-start lg:w-full text-xs lg:text-sm py-2 whitespace-nowrap flex-shrink-0"
                >
                  ⚙️ PREFS
                </TabsTrigger>
                <TabsTrigger 
                  value="fetch"
                  className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground font-bold justify-start lg:w-full text-xs lg:text-sm py-2 whitespace-nowrap flex-shrink-0"
                >
                  📥 FETCH
                </TabsTrigger>
                <TabsTrigger 
                  value="rate"
                  className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground font-bold justify-start lg:w-full text-xs lg:text-sm py-2 whitespace-nowrap flex-shrink-0"
                >
                  ⭐ RATE
                </TabsTrigger>
                <TabsTrigger 
                  value="classify"
                  className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground font-bold justify-start lg:w-full text-xs lg:text-sm py-2 whitespace-nowrap flex-shrink-0"
                >
                  🔍 CLASSIFY
                </TabsTrigger>
                <TabsTrigger 
                  value="train"
                  className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground font-bold justify-start lg:w-full text-xs lg:text-sm py-2 whitespace-nowrap flex-shrink-0"
                >
                  🎓 TRAIN
                </TabsTrigger>
                <TabsTrigger 
                  value="play"
                  className="data-[state=active]:bg-accent data-[state=active]:text-accent-foreground font-bold justify-start lg:w-full text-xs lg:text-sm py-2 whitespace-nowrap flex-shrink-0"
                >
                  ▶️ PLAY
                </TabsTrigger>
              </TabsList>

              {/* Tab Content Area */}
              <div className="flex-1">
                <TabsContent value="wizard" className="mt-0">
                  <WizardTab 
                    onStatusChange={handleStatusChange}
                    onSwitchTab={setActiveTab}
                  />
                </TabsContent>

                <TabsContent value="prefs" className="mt-0">
                  <PrefsTab onStatusChange={handleStatusChange} />
                </TabsContent>

                <TabsContent value="fetch" className="mt-0">
                  <FetchTab onStatusChange={handleStatusChange} />
                </TabsContent>

                <TabsContent value="rate" className="mt-0">
                  <RateTab onStatusChange={handleStatusChange} />
                </TabsContent>

                <TabsContent value="classify" className="mt-0">
                  <ClassifyTab onStatusChange={handleStatusChange} />
                </TabsContent>

                <TabsContent value="train" className="mt-0">
                  <TrainTab onStatusChange={handleStatusChange} />
                </TabsContent>

                <TabsContent value="play" className="mt-0">
                  <PlayTab
                    onStatusChange={handleStatusChange}
                    onTrackPlayed={handleTrackPlayed}
                  />
                </TabsContent>
              </div>
            </div>
          </Tabs>

          {/* Queue View */}
          {queue.length > 0 && <QueueView queue={queue} />}

          {/* Compact Footer */}
          <div className="text-center text-xs text-muted-foreground py-3 font-mono border-t border-border/50 mt-6">
            <p>READY.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
