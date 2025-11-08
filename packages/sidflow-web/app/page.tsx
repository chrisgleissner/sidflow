'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WizardTab } from '@/components/WizardTab';
import { PrefsTab } from '@/components/PrefsTab';
import { FetchTab } from '@/components/FetchTab';
import { RateTab } from '@/components/RateTab';
import { ClassifyTab } from '@/components/ClassifyTab';
import { TrainTab } from '@/components/TrainTab';
import { PlayTab } from '@/components/PlayTab';
import { QueueView } from '@/components/QueueView';
import { useToastContext } from '@/context/toast-context';
import { useRouter, useSearchParams } from 'next/navigation';

interface QueueItem {
  path: string;
  timestamp: number;
}

const TAB_VALUES = ['wizard', 'prefs', 'fetch', 'rate', 'classify', 'train', 'play'] as const;
type TabValue = (typeof TAB_VALUES)[number];

export default function Home() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const router = useRouter();
  const searchParams = useSearchParams();

  const searchTab = searchParams.get('tab')?.toLowerCase() ?? '';
  const resolvedTab: TabValue = TAB_VALUES.includes(searchTab as TabValue)
    ? (searchTab as TabValue)
    : 'wizard';

  const [activeTab, setActiveTab] = useState<TabValue>(resolvedTab);

  useEffect(() => {
    if (resolvedTab !== activeTab) {
      setActiveTab(resolvedTab);
    }
  }, [resolvedTab, activeTab]);

  const updateQueryTab = useCallback(
    (value: TabValue) => {
      const current = searchParams.get('tab');
      if (current === value) {
        return;
      }
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set('tab', value);
      const query = nextParams.toString();
      router.replace(query.length > 0 ? `/?${query}` : '/', { scroll: false });
    },
    [router, searchParams]
  );

  const handleTabChange = useCallback(
    (value: string) => {
      const normalized = TAB_VALUES.includes(value as TabValue) ? (value as TabValue) : 'wizard';
      setActiveTab(normalized);
      updateQueryTab(normalized);
    },
    [updateQueryTab]
  );

  const { showToast } = useToastContext();

  const handleStatusChange = (status: string, isError = false) => {
    showToast(status, { variant: isError ? 'error' : 'success' });
  };

  const handleTrackPlayed = (sidPath: string) => {
    setQueue((prev) => [
      { path: sidPath, timestamp: Date.now() },
      ...prev.slice(0, 9), // Keep last 10 tracks
    ]);
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-7xl mx-auto">
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
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <div className="flex flex-col lg:flex-row gap-4">
              <TabsList className="flex flex-row lg:flex-col lg:w-48 justify-start gap-2 h-auto p-2 bg-card border-2 border-border overflow-x-auto lg:overflow-x-visible flex-nowrap lg:flex-wrap">
                <TabsTrigger
                  value="wizard"
                  className="font-bold text-xs lg:text-sm py-2"
                  aria-label="WIZARD"
                  data-testid="tab-wizard"
                >
                  🧙 WIZARD
                </TabsTrigger>
                <TabsTrigger
                  value="prefs"
                  className="font-bold text-xs lg:text-sm py-2"
                  aria-label="PREFS"
                  data-testid="tab-prefs"
                >
                  ⚙️ PREFS
                </TabsTrigger>
                <TabsTrigger
                  value="fetch"
                  className="font-bold text-xs lg:text-sm py-2"
                  aria-label="FETCH"
                  data-testid="tab-fetch"
                >
                  📥 FETCH
                </TabsTrigger>
                <TabsTrigger
                  value="rate"
                  className="font-bold text-xs lg:text-sm py-2"
                  aria-label="RATE"
                  data-testid="tab-rate"
                >
                  ⭐ RATE
                </TabsTrigger>
                <TabsTrigger
                  value="classify"
                  className="font-bold text-xs lg:text-sm py-2"
                  aria-label="CLASSIFY"
                  data-testid="tab-classify"
                >
                  🔍 CLASSIFY
                </TabsTrigger>
                <TabsTrigger
                  value="train"
                  className="font-bold text-xs lg:text-sm py-2"
                  aria-label="TRAIN"
                  data-testid="tab-train"
                >
                  🎓 TRAIN
                </TabsTrigger>
                <TabsTrigger
                  value="play"
                  className="font-bold text-xs lg:text-sm py-2"
                  aria-label="PLAY"
                  data-testid="tab-play"
                >
                  ▶️ PLAY
                </TabsTrigger>
              </TabsList>

              <div className="flex-1">
                <TabsContent value="wizard" className="mt-0">
                  <WizardTab onStatusChange={handleStatusChange} onSwitchTab={setActiveTab} />
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
                  <PlayTab onStatusChange={handleStatusChange} onTrackPlayed={handleTrackPlayed} />
                </TabsContent>
              </div>
            </div>
          </Tabs>

          {queue.length > 0 && activeTab !== 'rate' && <QueueView queue={queue} />}

          <div className="text-center text-xs text-muted-foreground py-3 font-mono border-t border-border/50 mt-6">
            <p>READY.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
