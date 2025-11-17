'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WizardTab } from '@/components/WizardTab';
import { PrefsTab } from '@/components/PrefsTab';
import { FetchTab } from '@/components/FetchTab';
import { RateTab } from '@/components/RateTab';
import { ClassifyTab } from '@/components/ClassifyTab';
import { TrainTab } from '@/components/TrainTab';
import { PlayTab } from '@/components/PlayTab';
import { JobsTab } from '@/components/JobsTab';
import { FavoritesTab } from '@/components/FavoritesTab';
import { TopChartsTab } from '@/components/TopChartsTab';
import { QueueView } from '@/components/QueueView';
import { useToastContext } from '@/context/toast-context';
import { AdminCapabilityProvider, type Persona } from '@/context/admin-capability';
import { FavoritesProvider } from '@/contexts/FavoritesContext';

type TabKey = 'wizard' | 'prefs' | 'fetch' | 'rate' | 'classify' | 'train' | 'play' | 'jobs' | 'favorites' | 'charts';

interface QueueItem {
  path: string;
  timestamp: number;
}

interface SidflowAppProps {
  persona: Persona;
}

interface TabDefinition {
  key: TabKey;
  label: string;
  icon: string;
  render: (handlers: {
    onStatusChange: (status: string, isError?: boolean) => void;
    onTrackPlayed: (sidPath: string) => void;
    onSwitchTab: (tab: string) => void;
  }) => ReactNode;
}

const TAB_DEFINITIONS: TabDefinition[] = [
  {
    key: 'wizard',
    label: 'WIZARD',
    icon: '🧙',
    render: ({ onStatusChange, onSwitchTab }) => (
      <WizardTab onStatusChange={onStatusChange} onSwitchTab={onSwitchTab} />
    ),
  },
  {
    key: 'prefs',
    label: 'PREFS',
    icon: '⚙️',
    render: ({ onStatusChange }) => <PrefsTab onStatusChange={onStatusChange} />,
  },
  {
    key: 'fetch',
    label: 'FETCH',
    icon: '📥',
    render: ({ onStatusChange }) => <FetchTab onStatusChange={onStatusChange} />,
  },
  {
    key: 'rate',
    label: 'RATE',
    icon: '⭐',
    render: ({ onStatusChange }) => <RateTab onStatusChange={onStatusChange} />,
  },
  {
    key: 'classify',
    label: 'CLASSIFY',
    icon: '🔍',
    render: ({ onStatusChange }) => <ClassifyTab onStatusChange={onStatusChange} />,
  },
  {
    key: 'train',
    label: 'TRAIN',
    icon: '🎓',
    render: ({ onStatusChange }) => <TrainTab onStatusChange={onStatusChange} />,
  },
  {
    key: 'play',
    label: 'PLAY',
    icon: '▶️',
    render: ({ onStatusChange, onTrackPlayed }) => (
      <PlayTab onStatusChange={onStatusChange} onTrackPlayed={onTrackPlayed} />
    ),
  },
  {
    key: 'favorites',
    label: 'FAVORITES',
    icon: '❤️',
    render: ({ onStatusChange }) => <FavoritesTab onStatusChange={onStatusChange} />,
  },
  {
    key: 'charts',
    label: 'TOP CHARTS',
    icon: '📊',
    render: ({ onStatusChange, onTrackPlayed }) => (
      <TopChartsTab onPlayTrack={onTrackPlayed} onStatusChange={onStatusChange} />
    ),
  },
  {
    key: 'jobs',
    label: 'JOBS',
    icon: '📋',
    render: ({ onStatusChange }) => <JobsTab onStatusChange={onStatusChange} />,
  },
];

export function SidflowApp({ persona }: SidflowAppProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const allowedTabs: TabKey[] = useMemo(
    () => (persona === 'admin' ? TAB_DEFINITIONS.map((tab) => tab.key) : ['play', 'favorites', 'charts', 'prefs']),
    [persona]
  );

  const defaultTab: TabKey = persona === 'admin' ? 'wizard' : 'play';

  const rawQueryTab = searchParams.get('tab')?.toLowerCase() ?? null;
  const normalizedQueryTab = rawQueryTab && allowedTabs.includes(rawQueryTab as TabKey)
    ? (rawQueryTab as TabKey)
    : null;

  const [activeTab, setActiveTab] = useState<TabKey>(normalizedQueryTab ?? defaultTab);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  useEffect(() => {
    if (persona === 'admin' && normalizedQueryTab && normalizedQueryTab !== activeTab) {
      setActiveTab(normalizedQueryTab);
    }
  }, [persona, normalizedQueryTab, activeTab]);

  useEffect(() => {
    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(defaultTab);
    }
  }, [allowedTabs, activeTab, defaultTab]);

  useEffect(() => {
    document.body.dataset.persona = persona;
    return () => {
      delete document.body.dataset.persona;
    };
  }, [persona]);

  const { showToast } = useToastContext();

  const handleStatusChange = useCallback(
    (status: string, isError = false) => {
      showToast(status, { variant: isError ? 'error' : 'success' });
    },
    [showToast]
  );

  const handleTrackPlayed = useCallback((sidPath: string) => {
    if (persona !== 'admin') {
      return;
    }
    setQueue((prev) => [
      { path: sidPath, timestamp: Date.now() },
      ...prev.slice(0, 9),
    ]);
  }, [persona]);

  const handleSwitchTab = useCallback(
    (tabValue: string) => {
      if (!allowedTabs.includes(tabValue as TabKey)) {
        return;
      }
      const tab = tabValue as TabKey;
      setActiveTab(tab);
      if (persona === 'admin') {
        const nextParams = new URLSearchParams(searchParams.toString());
        nextParams.set('tab', tab);
        const nextQuery = nextParams.toString();
        const basePath = pathname.startsWith('/admin') ? '/admin' : pathname || '/admin';
        router.replace(
          nextQuery.length > 0 ? `${basePath}?${nextQuery}` : basePath,
          { scroll: false }
        );
      }
    },
    [allowedTabs, persona, router, searchParams, pathname]
  );

  const handleTabChange = useCallback(
    (value: string) => {
      const normalized = allowedTabs.includes(value as TabKey) ? (value as TabKey) : defaultTab;
      handleSwitchTab(normalized);
    },
    [allowedTabs, defaultTab, handleSwitchTab]
  );

  const tabLookup = useMemo(() => {
    return new Map<TabKey, TabDefinition>(TAB_DEFINITIONS.map((def) => [def.key, def]));
  }, []);

  const visibleTabs = useMemo(
    () =>
      TAB_DEFINITIONS.filter((tab) => allowedTabs.includes(tab.key)),
    [allowedTabs]
  );

  return (
    <AdminCapabilityProvider persona={persona}>
      <FavoritesProvider>
        <div className="min-h-screen bg-background" data-persona={persona} suppressHydrationWarning>
        <main className="max-w-7xl mx-auto">
          <header className="bg-card border-b-4 border-border px-6 py-3 shadow-lg">
            <div className="flex items-center gap-4">
              <Image
                src="/logo-small.png"
                alt="SIDFlow"
                width={60}
                height={40}
                className="w-[60px] h-[40px]"
                priority
              />
              <div className="flex-1">
                <h1 className="text-xl font-bold text-foreground tracking-tight leading-tight">
                  SIDFlow
                </h1>
                <p className="text-xs text-muted-foreground leading-tight">
                  {persona === 'admin'
                    ? 'COMMODORE 64 MUSIC CONTROL & OPERATIONS'
                    : 'COMMODORE 64 MUSIC PLAYER'}
                </p>
              </div>
              <div className="hidden md:flex items-center gap-3 text-xs font-mono text-muted-foreground">
                {visibleTabs.map((tab) => (
                  <span key={tab.key} className="px-2 py-1 bg-accent/20 rounded">
                    {tab.label}
                  </span>
                ))}
              </div>
            </div>
          </header>

          <div className="p-4 md:p-6 space-y-4">
            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
              <div className="flex flex-col lg:flex-row gap-4">
                <TabsList className="flex flex-row lg:flex-col lg:w-48 justify-start gap-2 h-auto p-2 bg-card border-2 border-border overflow-x-auto lg:overflow-x-visible flex-nowrap lg:flex-wrap">
                  {visibleTabs.map((tab) => (
                    <TabsTrigger
                      key={tab.key}
                      value={tab.key}
                      className="font-bold text-xs lg:text-sm py-2"
                      aria-label={tab.label}
                      data-testid={`tab-${tab.key}`}
                    >
                      <span className="mr-2" aria-hidden>{tab.icon}</span>
                      {tab.label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <div className="flex-1">
                  {visibleTabs.map((tab) => {
                    const def = tabLookup.get(tab.key);
                    if (!def) {
                      return null;
                    }
                    return (
                      <TabsContent key={tab.key} value={tab.key} className="mt-0">
                        {def.render({
                          onStatusChange: handleStatusChange,
                          onTrackPlayed: handleTrackPlayed,
                          onSwitchTab: handleSwitchTab,
                        })}
                      </TabsContent>
                    );
                  })}
                </div>
              </div>
            </Tabs>

            {persona === 'admin' && queue.length > 0 && <QueueView queue={queue} />}

            <div className="text-center text-xs text-muted-foreground py-3 font-mono border-t border-border/50 mt-6">
              <p>{persona === 'admin' ? 'OPERATIONS READY.' : 'READY TO PLAY.'}</p>
            </div>
          </div>
        </main>
      </div>
      </FavoritesProvider>
    </AdminCapabilityProvider>
  );
}
