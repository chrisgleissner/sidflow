'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { classifyPath, getHvscPaths, getClassifyProgress } from '@/lib/api-client';
import type { ClassifyProgressSnapshot } from '@/lib/types/classify-progress';
import { formatApiError } from '@/lib/format-error';

interface ClassifyTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

export function ClassifyTab({ onStatusChange }: ClassifyTabProps) {
  const [path, setPath] = useState('');
  const [defaultPath, setDefaultPath] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<ClassifyProgressSnapshot | null>(null);

  const isRunning = progress?.isActive ?? false;
  const percent = progress?.percentComplete ?? 0;
  const processed = progress?.processedFiles ?? 0;
  const total = progress?.totalFiles ?? 0;
  const remaining = Math.max(total - processed, 0);
  const phaseLabel = (progress?.phase ?? 'idle').toUpperCase();

  useEffect(() => {
    let mounted = true;
    const loadPaths = async () => {
      const response = await getHvscPaths();
      if (mounted && response.success) {
        setDefaultPath(response.data.musicPath || response.data.hvscPath);
        setPath(response.data.musicPath || response.data.hvscPath);
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

  const handleClassify = useCallback(async () => {
    const target = path || defaultPath;
    if (!target) {
      onStatusChange('Unable to determine HVSC path', true);
      return;
    }

    setIsLoading(true);
    onStatusChange('Starting classification...');

    try {
      const response = await classifyPath({ path: target });
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
  }, [path, defaultPath, onStatusChange, refreshProgress]);

  const threadStatuses = useMemo(() => {
    return progress?.perThread ?? [];
  }, [progress]);

  return (
    <Card className="c64-border">
      <CardHeader>
        <CardTitle className="petscii-text text-accent">CLASSIFY</CardTitle>
        <CardDescription className="text-muted-foreground">
          Build WAV cache and generate metadata for your HVSC mirror
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label htmlFor="classify-path" className="text-xs font-semibold tracking-tight text-muted-foreground">
              HVSC PATH
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
            <Button
              onClick={handleClassify}
              disabled={isLoading || isRunning}
              className="w-full retro-glow"
            >
              {isLoading ? 'CLASSIFYING...' : isRunning ? 'CLASSIFICATION IN PROGRESS' : 'START CLASSIFICATION'}
            </Button>
            <p className="text-xs text-muted-foreground">
              SIDFlow auto-detects your HVSC mirror. Adjust the path if you keep SIDs elsewhere.
            </p>
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
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>THREAD ACTIVITY</span>
            <span>{threadStatuses.length} threads</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {threadStatuses.map((thread) => (
              <div
                key={thread.id}
                className="rounded border border-border/60 bg-card/80 px-3 py-2 text-xs font-mono text-muted-foreground"
              >
                <p className="text-[11px] uppercase tracking-wide text-foreground">Thread {thread.id}</p>
                <p className="truncate">
                  {thread.status === 'working' && thread.currentFile
                    ? thread.currentFile
                    : 'Idle'}
                </p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
