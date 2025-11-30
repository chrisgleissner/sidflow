'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { 
  classifyPath, 
  getSidCollectionPaths, 
  getClassifyProgress, 
  controlClassification, 
  getSchedulerConfig,
  updateSchedulerConfig,
  exportClassifications,
  importClassifications,
  type ClassifyProgressWithStorage,
  type SchedulerConfig,
  type RenderPrefs,
  type SchedulerStatus,
  type ClassificationExportData,
} from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';

interface ClassifyTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

/** Supported export format version for import validation */
const SUPPORTED_EXPORT_VERSION = '1.0';

const CLASSIFICATION_STEPS = [
  {
    title: '1. Reading Metadata',
    detail: 'Scans every SID file to read song count and metadata. Progress shows X/Y files analyzed.',
  },
  {
    title: '2. Rendering Audio',
    detail: 'Converts SID files to WAV using sidplayfp. Only renders missing/stale WAVs unless "Force Rebuild" is enabled.',
  },
  {
    title: '3. Extracting Features',
    detail: 'Analyzes WAV files with Essentia.js to extract audio descriptors (energy, tempo, spectral features).',
  },
  {
    title: '4. Generating Ratings & Tags',
    detail: 'Predicts e/m/c ratings using features and metadata, then writes auto-tags.json files for playlist generation.',
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
  
  // Scheduler state
  const [schedulerConfig, setSchedulerConfig] = useState<SchedulerConfig>({
    enabled: false,
    time: '06:00',
    timezone: 'UTC',
  });
  const [renderPrefs, setRenderPrefs] = useState<RenderPrefs>({
    preserveWav: true,
    enableFlac: false,
    enableM4a: false,
  });
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [isSavingScheduler, setIsSavingScheduler] = useState(false);
  
  // Export/Import state
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isRunning = progress?.isActive ?? false;
  const percent = progress?.percentComplete ?? 0;
  const processed = progress?.processedFiles ?? 0;
  const total = progress?.totalFiles ?? 0;
  const remaining = Math.max(total - processed, 0);
  
  // Map raw phase names to user-friendly labels matching CLASSIFICATION_STEPS
  const getPhaseLabel = (phase?: string): string => {
    switch (phase) {
      case 'analyzing': return 'Analyzing Collection';
      case 'metadata': return 'Reading Metadata';
      case 'building': return 'Rendering Audio';
      case 'tagging': return 'Extracting Features & Tagging';
      case 'idle': return 'Idle';
      default: return phase ? phase.toUpperCase() : 'Idle';
    }
  };
  const phaseLabel = getPhaseLabel(progress?.phase);

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

  // Load scheduler config on mount
  useEffect(() => {
    let mounted = true;
    const loadScheduler = async () => {
      try {
        const response = await getSchedulerConfig();
        if (mounted && response.success) {
          setSchedulerConfig(response.data.scheduler);
          setRenderPrefs(response.data.renderPrefs);
          setSchedulerStatus(response.data.status);
        }
      } catch (error) {
        console.error('[ClassifyTab] Failed to load scheduler config', error);
      }
    };
    void loadScheduler();
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

  // Scheduler handlers
  const handleSaveScheduler = useCallback(async () => {
    setIsSavingScheduler(true);
    try {
      const response = await updateSchedulerConfig({
        scheduler: schedulerConfig,
        renderPrefs: renderPrefs,
      });
      if (response.success) {
        setSchedulerConfig(response.data.scheduler);
        setRenderPrefs(response.data.renderPrefs);
        setSchedulerStatus(response.data.status);
        onStatusChange('Scheduler settings saved');
      } else {
        onStatusChange(`Failed to save scheduler: ${formatApiError(response)}`, true);
      }
    } catch (error) {
      onStatusChange(`Failed to save scheduler: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      setIsSavingScheduler(false);
    }
  }, [schedulerConfig, renderPrefs, onStatusChange]);

  // Export handler
  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const blob = await exportClassifications();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sidflow-classifications-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onStatusChange('Classifications exported successfully');
    } catch (error) {
      onStatusChange(`Export failed: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      setIsExporting(false);
    }
  }, [onStatusChange]);

  // Import handler
  const handleImport = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text) as ClassificationExportData;
      
      // Validate the data
      if (data.version !== SUPPORTED_EXPORT_VERSION) {
        throw new Error(`Unsupported version: ${data.version}. Expected: ${SUPPORTED_EXPORT_VERSION}`);
      }
      
      const response = await importClassifications(data);
      if (response.success) {
        onStatusChange(`Imported ${response.data.entriesWritten} classifications to ${response.data.filesWritten} files`);
      } else {
        onStatusChange(`Import failed: ${formatApiError(response)}`, true);
      }
    } catch (error) {
      onStatusChange(`Import failed: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      setIsImporting(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [onStatusChange]);

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
                data-testid="force-rebuild-checkbox"
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
                  data-testid="start-classify-button"
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
                const threadPhaseLabel = getPhaseLabel(thread.phase);
                const isWorking = thread.status === 'working';
                const isStale = Boolean(thread.stale && isWorking);
                const elapsed = formatElapsed(thread.phaseStartedAt);
                const headline = isWorking
                  ? thread.currentFile ?? (isStale ? 'Working (no recent update)' : 'Working...')
                  : 'Waiting for work';
                const phaseText = isStale
                  ? `${threadPhaseLabel} (STALE)`
                  : (isWorking && elapsed ? `${threadPhaseLabel}${elapsed}` : threadPhaseLabel);
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

        {/* Scheduler Configuration */}
        <div className="rounded border border-border/60 bg-muted/30 p-3 space-y-3">
          <p className="text-xs font-semibold tracking-tight text-muted-foreground">
            NIGHTLY SCHEDULER
          </p>
          <p className="text-xs text-muted-foreground">
            Automatically run fetch + classify at a scheduled time each day.
          </p>
          
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid="scheduler-enabled-checkbox"
                  checked={schedulerConfig.enabled}
                  onChange={(e) => setSchedulerConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                  className="h-4 w-4 rounded border-border bg-input text-accent focus:ring-2 focus:ring-ring cursor-pointer"
                />
                <span className="text-xs text-foreground">Enable nightly scheduler</span>
              </label>
              
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Time (UTC):</label>
                <Input
                  type="time"
                  data-testid="scheduler-time-input"
                  value={schedulerConfig.time}
                  onChange={(e) => setSchedulerConfig(prev => ({ ...prev, time: e.target.value }))}
                  className="w-28 h-8 text-xs"
                  disabled={!schedulerConfig.enabled}
                />
              </div>
              
              {schedulerStatus && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Status: {schedulerStatus.isActive ? '🟢 Active' : '⚪ Inactive'}</p>
                  {schedulerStatus.nextRun && (
                    <p>Next run: {new Date(schedulerStatus.nextRun).toLocaleString()}</p>
                  )}
                  {schedulerStatus.lastRun && (
                    <p>Last run: {new Date(schedulerStatus.lastRun).toLocaleString()}</p>
                  )}
                </div>
              )}
            </div>
            
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Render Preferences</p>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid="preserve-wav-checkbox"
                  checked={renderPrefs.preserveWav}
                  onChange={(e) => setRenderPrefs(prev => ({ ...prev, preserveWav: e.target.checked }))}
                  className="h-4 w-4 rounded border-border bg-input text-accent focus:ring-2 focus:ring-ring cursor-pointer"
                />
                <span className="text-xs text-foreground">Preserve WAV files after classification</span>
              </label>
              <p className="text-[11px] text-muted-foreground pl-6">
                Disable to save disk space on resource-constrained deployments.
              </p>
            </div>
          </div>
          
          <Button
            onClick={handleSaveScheduler}
            disabled={isSavingScheduler}
            variant="secondary"
            size="sm"
            data-testid="save-scheduler-button"
          >
            {isSavingScheduler ? 'Saving...' : 'Save Scheduler Settings'}
          </Button>
        </div>

        {/* Export/Import Classifications */}
        <div className="rounded border border-border/60 bg-muted/30 p-3 space-y-3">
          <p className="text-xs font-semibold tracking-tight text-muted-foreground">
            EXPORT / IMPORT CLASSIFICATIONS
          </p>
          <p className="text-xs text-muted-foreground">
            Export all classification data to a JSON file, or import classifications from a previous export.
            Useful for bootstrapping new deployments from local classification runs.
          </p>
          
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleExport}
              disabled={isExporting || isRunning}
              variant="secondary"
              size="sm"
              data-testid="export-classifications-button"
            >
              {isExporting ? 'Exporting...' : 'Export Classifications'}
            </Button>
            
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              onChange={handleImport}
              className="hidden"
              data-testid="import-file-input"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting || isRunning}
              variant="outline"
              size="sm"
              data-testid="import-classifications-button"
            >
              {isImporting ? 'Importing...' : 'Import Classifications'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
