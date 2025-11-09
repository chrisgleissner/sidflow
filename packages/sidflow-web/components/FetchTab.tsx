'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { fetchHvsc, fetchHvscProgress } from '@/lib/api-client';
import type { FetchProgressSnapshot } from '@/lib/types/fetch-progress';

interface FetchTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

export function FetchTab({ onStatusChange }: FetchTabProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [progress, setProgress] = useState<FetchProgressSnapshot | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    const bootstrap = async () => {
      try {
        const response = await fetchHvscProgress();
        if (!response.success || isCancelled) {
          return;
        }
        const snapshot = response.data;
        setProgress(snapshot);
        setLogLines(snapshot.logs);
        setIsLoading(snapshot.isActive);
        if (snapshot.isActive) {
          setIsPolling(true);
        }
      } catch (error) {
        console.error('[FetchTab] Failed to load initial fetch state', error);
      }
    };

    void bootstrap();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isPolling) {
      return;
    }

    let isCancelled = false;

    const poll = async () => {
      try {
        const response = await fetchHvscProgress();
        if (!response.success || isCancelled) {
          return;
        }
        const snapshot = response.data;
        setProgress(snapshot);
        setLogLines(snapshot.logs);
        setIsLoading(snapshot.isActive);
        if (!snapshot.isActive) {
          setIsPolling(false);
        }
      } catch (error) {
        console.error('[FetchTab] Failed to poll fetch progress', error);
        if (!isCancelled) {
          setIsPolling(false);
          setIsLoading(false);
        }
      }
    };

    poll();
    const interval = setInterval(poll, 2000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [isPolling]);

  const handleFetch = async () => {
    setIsLoading(true);
    setLogLines([]);
    setProgress(null);
    setIsPolling(true);
    onStatusChange('Fetching HVSC collection...');

    try {
      const response = await fetchHvsc();

      if (response.success) {
        const snapshot = response.data.progress;
        if (snapshot) {
          setProgress(snapshot);
          setLogLines(snapshot.logs);
          setIsPolling(snapshot.isActive);
          setIsLoading(snapshot.isActive);
        } else {
          const logs = response.data.logs || response.data.output || 'sidflow-fetch completed with no log output.';
          setLogLines(logs.split('\n'));
          setIsPolling(false);
          setIsLoading(false);
        }
        onStatusChange('HVSC fetch completed successfully');
      } else {
        const details = response.details ? ` – ${response.details}` : '';
        const logs = response.logs || response.details || 'sidflow-fetch did not return logs. Check server console.';
        setLogLines(logs.split('\n'));
        const snapshot = response.progress;
        if (snapshot && 'percent' in snapshot && 'logs' in snapshot) {
          // Type guard: only set if it's a FetchProgressSnapshot
          setProgress(snapshot);
          setIsPolling(snapshot.isActive);
          setIsLoading(snapshot.isActive);
        } else {
          setIsPolling(false);
          setIsLoading(false);
        }
        onStatusChange(`Fetch failed: ${response.error}${details}`, true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLogLines(message.split('\n'));
      setIsPolling(false);
      onStatusChange(`Failed to fetch HVSC: ${message}`, true);
      setIsLoading(false);
    }
  };

  return (
    <Card className="c64-border">
      <CardHeader>
        <CardTitle className="petscii-text text-accent">FETCH HVSC</CardTitle>
        <CardDescription className="text-muted-foreground">
          Download or update the High Voltage SID Collection
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {progress && (
          <div className="space-y-2 rounded border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-muted-foreground uppercase tracking-tight">{progress.phase}</span>
              <span className="text-foreground">{Math.round(progress.percent)}%</span>
            </div>
            <Progress value={progress.percent} className="h-2 bg-background/60" />
            <p className="text-xs text-muted-foreground">
              {progress.message}
              {progress.filename ? ` • ${progress.filename}` : ''}
            </p>
          </div>
        )}

        <div className="relative">
          <Button
            onClick={handleFetch}
            disabled={isLoading}
            className="w-full retro-glow peer"
            variant="default"
          >
            {isLoading ? 'FETCHING...' : 'START FETCH'}
          </Button>
          <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 hidden w-max -translate-x-1/2 rounded bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow peer-hover:block">
            Synchronizes your local HVSC mirror with the latest release (the first run can take several minutes)
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Latest CLI output</p>
          <pre className="min-h-[120px] max-h-[260px] w-full rounded border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed overflow-auto whitespace-pre-wrap">
            {logLines.length > 0 ? logLines.join('\n') : 'Run fetch to view sidflow-fetch logs here.'}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
