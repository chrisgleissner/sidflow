'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { classifyPath, getSidCollectionPaths, getClassifyProgress, controlClassification, type ClassifyProgressWithStorage } from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';

interface ClassifyTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

const CLASSIFICATION_STEPS = [
  {
    title: 'Analyze HVSC',
    detail: 'Scans every SID file and song index to see which WAV renders are missing or stale.',
  },
  {
    title: 'Render WAV cache',
    detail: 'Runs sidplayfp in parallel (one core per thread) to regenerate audio that downstream tools can reuse.',
  },
  {
    title: 'Metadata & auto-tags',
    detail: 'Parses SID metadata, extracts audio features, and predicts ratings so tags stay in sync with your feedback.',
  },
];

function formatBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return '—';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '—';
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function ClassifyTab({ onStatusChange }: ClassifyTabProps) {
  const [path, setPath] = useState('');
  const [defaultPath, setDefaultPath] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [forceRebuild, setForceRebuild] = useState(false);
  const [progress, setProgress] = useState<ClassifyProgressWithStorage | null>(null);
  const [, setTick] = useState(0);

  const isRunning = progress?.isActive ?? false;
  const percent = progress?.percentComplete ?? 0;
  const processed = progress?.processedFiles ?? 0;
  const total = progress?.totalFiles ?? 0;
  const remaining = Math.max(total - processed, 0);
  const phaseLabel = (progress?.phase ?? 'idle').toUpperCase();

  useEffect(() => {
    let mounted = true;
    const loadPaths = async () => {
      const response = await getSidCollectionPaths();
      if (mounted && response.success) {
        const preferred = response.data.activeCollectionPath ?? response.data.musicPath;
        setDefaultPath(preferred);
        setPath(preferred);
      }
    };
    void loadPaths();
    return () => {
      mounted = false;
    };
  }, []);

  const refreshProgress = useCallback(async () => {
    const response = await getClassifyProgress();
    if (response.success) {
      setProgress(response.data);
    }
  }, []);

  useEffect(() => {
    void refreshProgress();
    const interval = setInterval(refreshProgress, isRunning ? 1000 : 4000);
    return () => clearInterval(interval);
  }, [refreshProgress, isRunning]);

  // Force re-render every 3 seconds to update elapsed time counters
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 3000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const handleClassify = useCallback(async () => {
    const target = path || defaultPath;
    if (!target) {
      onStatusChange('Unable to determine SID path', true);
      return;
    }

    // Confirm force rebuild if enabled
    if (forceRebuild) {
      const confirmed = window.confirm(
        'WARNING: Force rebuild will DELETE and RE-RENDER all WAV files in the cache.\n\n' +
        'This will:\n' +
        '• Delete all existing WAV files\n' +
        '• Re-render thousands of files (may take hours)\n' +
        '• Use significant CPU and disk I/O\n\n' +
        'Are you sure you want to continue?'
      );
      if (!confirmed) {
        onStatusChange('Force rebuild cancelled');
        return;
      }
    }

    setIsLoading(true);
    onStatusChange(forceRebuild ? 'Starting FORCE REBUILD...' : 'Starting classification...');

    try {
      const response = await classifyPath({ path: target, forceRebuild });
      if (response.success) {
        onStatusChange('Classification completed successfully');
        await refreshProgress();
      } else {
        onStatusChange(`Classification failed: ${formatApiError(response)}`, true);
      }
    } catch (error) {
      onStatusChange(`Failed to classify: ${error}`, true);
    } finally {
      setIsLoading(false);
    }
  }, [path, defaultPath, forceRebuild, onStatusChange, refreshProgress]);

  const threadStatuses = useMemo(() => progress?.perThread ?? [], [progress]);
  const storageStats = progress?.storage;

  // Helper to format elapsed time as "XXs"
  const formatElapsed = useCallback((startedAt?: number) => {
    if (!startedAt) return '';
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    return elapsedSec > 0 ? ` (${elapsedSec}s)` : '';
  }, []);
  const estimatedMsRemaining = useMemo(() => {
    if (!progress || progress.totalFiles === 0 || progress.processedFiles === 0) {
      return null;
    }
    const remaining = Math.max(progress.totalFiles - progress.processedFiles, 0);
    if (remaining === 0) {
      return 0;
    }
    const elapsedMs = Math.max(progress.updatedAt - progress.startedAt, 1);
    const ratePerMs = progress.processedFiles / elapsedMs;
    if (ratePerMs <= 0) {
      return null;
    }
    return remaining / ratePerMs;
  }, [progress]);

  const formattedEta = useMemo(() => {
    if (estimatedMsRemaining === null) {
      return '—';
    }
    if (estimatedMsRemaining === 0) {
      return 'Done';
    }
    return formatDuration(Math.round(estimatedMsRemaining));
  }, [estimatedMsRemaining]);

  const diskSummary = useMemo(() => {
    if (!storageStats) {
      return null;
    }
    const usedText = formatBytes(storageStats.usedBytes);
    const totalText = formatBytes(storageStats.totalBytes);
    const freeText = formatBytes(storageStats.freeBytes);
    return {
      headline: `${usedText} / ${totalText} used`,
      free: `${freeText} free`,
    };
  }, [storageStats]);

  const handlePause = useCallback(async () => {
    try {
      const response = await controlClassification('pause');
      if (response.success) {
        onStatusChange('Pausing classification...');
        await refreshProgress();
      } else {
        onStatusChange(`Unable to pause: ${formatApiError(response)}`, true);
      }
    } catch (error) {
      onStatusChange(
        `Unable to pause: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
    }
  }, [onStatusChange, refreshProgress]);

  return (
    <Card className="c64-border">
      <CardHeader>
        <CardTitle className="petscii-text text-accent">CLASSIFY</CardTitle>
        <CardDescription className="text-muted-foreground">
          Build WAV cache and generate metadata for your HVSC mirror
        </CardDescription>
        {progress?.renderEngine && (
          <div className="mt-2 rounded border border-accent/30 bg-accent/10 px-3 py-2">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <p className="text-xs font-semibold text-muted-foreground">ENGINE PREFERENCE</p>
                <p className="font-mono text-xs text-muted-foreground">{progress.renderEngine.toUpperCase()}</p>
              </div>
              {progress.activeEngine && (
                <div className="flex-1">
                  <p className="text-xs font-semibold text-muted-foreground">ACTIVE NOW</p>
                  <p className="font-mono text-sm font-bold text-accent">{progress.activeEngine.toUpperCase()}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label htmlFor="classify-path" className="text-xs font-semibold tracking-tight text-muted-foreground">
              SID PATH
            </label>
            <input
              id="classify-path"
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={defaultPath}
              className="w-full px-3 py-2 bg-input border border-border rounded text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={isLoading || isRunning}
            />
            <div className={`flex items-center gap-2 px-3 py-2 rounded border ${forceRebuild ? 'border-red-500/50 bg-red-500/10' : 'border-border/30 bg-muted/20'} transition-colors`}>
              <input
                id="force-rebuild"
                type="checkbox"
                checked={forceRebuild}
                onChange={(e) => setForceRebuild(e.target.checked)}
                disabled={isLoading || isRunning}
                className="h-4 w-4 rounded border-border bg-input text-accent focus:ring-2 focus:ring-ring cursor-pointer"
              />
              <label htmlFor="force-rebuild" className="text-xs cursor-pointer select-none flex-1 text-muted-foreground">
                Force rebuild (delete and re-render all WAV files)
              </label>
            </div>
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Button
                  onClick={handleClassify}
                  disabled={isLoading || isRunning}
                  className="w-full retro-glow peer"
                >
                  {isLoading
                    ? 'CLASSIFYING...'
                    : isRunning
                      ? 'CLASSIFICATION IN PROGRESS'
                      : progress?.isPaused
                        ? 'RESUME CLASSIFICATION'
                        : 'START CLASSIFICATION'}
                </Button>
                <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 hidden w-max -translate-x-1/2 rounded bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow peer-hover:block">
                  Uses your preferred SID folder; adjust the path above if you need a different target
                </div>
              </div>
              {isRunning && !progress?.isPaused && (
                <Button
                  onClick={handlePause}
                  disabled={isLoading}
                  variant="outline"
                  className="w-full"
                >
                  PAUSE
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2 rounded border border-border/60 bg-muted/30 p-3">
            <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
              <span>{phaseLabel}</span>
              <span>{percent.toFixed(1)}%</span>
            </div>
            <Progress value={percent} className="h-2 bg-background/60" />
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <p className="text-muted-foreground">Processed</p>
                <p className="font-semibold text-foreground">{processed}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Remaining</p>
                <p className="font-semibold text-foreground">{remaining}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Rendered</p>
                <p className="font-semibold text-foreground">{progress?.renderedFiles ?? 0}</p>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded border border-border/60 bg-card/70 p-2 text-center text-xs">
                <p className="text-muted-foreground">Time Remaining</p>
                <p className="font-semibold text-foreground">{formattedEta}</p>
              </div>
              <div className="rounded border border-border/60 bg-card/70 p-2 text-center text-xs">
                <p className="text-muted-foreground">Disk Usage</p>
                {diskSummary ? (
                  <>
                    <p className="font-semibold text-foreground">{diskSummary.headline}</p>
                    <p className="text-muted-foreground">{diskSummary.free}</p>
                  </>
                ) : (
                  <p className="font-semibold text-foreground">—</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>THREAD ACTIVITY</span>
            <span>{progress?.threads ?? threadStatuses.length} threads</span>
          </div>
          {threadStatuses.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {threadStatuses.map((thread) => {
                const phaseLabel = thread.phase ? thread.phase.toUpperCase() : 'IDLE';
                const isWorking = thread.status === 'working';
                const isStale = Boolean(thread.stale && isWorking);
                const elapsed = formatElapsed(thread.phaseStartedAt);
                const headline = isWorking
                  ? thread.currentFile ?? (isStale ? 'Working (no recent update)' : 'Working...')
                  : 'Waiting for work';
                const phaseText = isStale
                  ? `${phaseLabel} (STALE)`
                  : (isWorking && elapsed ? `${phaseLabel}${elapsed}` : phaseLabel);
                return (
                  <div
                    key={thread.id}
                    className="rounded border border-border/60 bg-card/80 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-wide">
                      <span className="text-foreground">Thread {thread.id}</span>
                      <span className={isWorking ? 'text-accent' : 'text-muted-foreground'}>{phaseText}</span>
                    </div>
                    <p
                      className={`mt-1 font-mono ${isWorking ? 'text-foreground' : 'text-muted-foreground'
                        }`}
                      title={headline}
                    >
                      {headline}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded border border-dashed border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              Waiting for classification to start...
            </div>
          )}
        </div>

        <div className="rounded border border-border/60 bg-muted/30 p-3 space-y-3">
          <p className="text-xs font-semibold tracking-tight text-muted-foreground">
            WHAT CLASSIFICATION DOES
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {CLASSIFICATION_STEPS.map((step) => (
              <div key={step.title}>
                <p className="text-xs font-semibold text-foreground">{step.title}</p>
                <p className="text-xs text-muted-foreground">{step.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
