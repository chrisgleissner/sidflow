'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { triggerFeedbackSync, triggerFeedbackTraining } from '@/lib/feedback/runtime';
import { useFeedbackRuntimeState } from '@/lib/feedback/use-feedback-runtime';

interface TrainTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

export function TrainTab({ onStatusChange }: TrainTabProps) {
  const runtime = useFeedbackRuntimeState();
  const [trainQueuedAt, setTrainQueuedAt] = useState<number | null>(null);
  const [syncQueuedAt, setSyncQueuedAt] = useState<number | null>(null);

  const lastTrainingSummary = useMemo(() => {
    if (!runtime.lastTraining) {
      return 'No local training runs yet';
    }
    const { timestamp, samples, durationMs, modelVersion } = runtime.lastTraining;
    const when = new Date(timestamp).toLocaleString();
    const durationSeconds = durationMs ? (durationMs / 1000).toFixed(1) : '0.0';
    return `Last run ${when} · ${samples} samples · ${durationSeconds}s · ${modelVersion}`;
  }, [runtime.lastTraining]);

  const pendingUploads = useMemo(() => {
    if (!runtime.lastSync) {
      return 0;
    }
    return runtime.lastSync.pendingRatings + runtime.lastSync.pendingImplicit;
  }, [runtime.lastSync]);

  const handleTrainNow = useCallback(() => {
    if (!runtime.trainingEnabled) {
      onStatusChange('Enable background training in Preferences first', true);
      return;
    }
    triggerFeedbackTraining('train-tab');
    setTrainQueuedAt(Date.now());
    onStatusChange('Queued local training run');
  }, [onStatusChange, runtime.trainingEnabled]);

  const handleSyncNow = useCallback(() => {
    if (!runtime.uploadingEnabled) {
      onStatusChange('Enable feedback uploads in Preferences first', true);
      return;
    }
    triggerFeedbackSync();
    setSyncQueuedAt(Date.now());
    onStatusChange('Sync run requested');
  }, [onStatusChange, runtime.uploadingEnabled]);

  useEffect(() => {
    if (trainQueuedAt && runtime.lastTraining && runtime.lastTraining.timestamp >= trainQueuedAt) {
      setTrainQueuedAt(null);
    }
  }, [runtime.lastTraining, trainQueuedAt]);

  useEffect(() => {
    if (syncQueuedAt && runtime.lastSync && runtime.lastSync.timestamp >= syncQueuedAt) {
      setSyncQueuedAt(null);
    }
  }, [runtime.lastSync, syncQueuedAt]);

  return (
    <Card className="c64-border">
      <CardHeader>
        <CardTitle className="petscii-text text-accent">TRAIN MODEL</CardTitle>
        <CardDescription className="text-muted-foreground">
          Background training runs automatically when enabled. Use the shortcuts below to queue runs or force a sync.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="rounded border border-border bg-muted/30 p-3 leading-relaxed">
          <p className="font-medium text-foreground">Runtime status</p>
          <dl className="mt-2 grid gap-1 text-muted-foreground">
            <div>
              <dt className="inline">Training: </dt>
              <dd className="inline">
                {runtime.trainingEnabled ? 'Enabled' : 'Disabled'}
                {trainQueuedAt && runtime.trainingEnabled ? ` · queued ${new Date(trainQueuedAt).toLocaleTimeString()}` : ''}
              </dd>
            </div>
            <div>
              <dt className="inline">Uploads: </dt>
              <dd className="inline">
                {runtime.uploadingEnabled ? 'Enabled' : 'Disabled'}
                {syncQueuedAt && runtime.uploadingEnabled ? ` · queued ${new Date(syncQueuedAt).toLocaleTimeString()}` : ''}
              </dd>
            </div>
            <div>
              <dt className="inline">Local Model: </dt>
              <dd className="inline">{runtime.localModelVersion ?? 'None yet'}</dd>
            </div>
            <div>
              <dt className="inline">Base Model: </dt>
              <dd className="inline">{runtime.baseModelVersion ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt className="inline">Last Training: </dt>
              <dd className="inline">{lastTrainingSummary}</dd>
            </div>
            <div>
              <dt className="inline">Pending Uploads: </dt>
              <dd className="inline">{pendingUploads}</dd>
            </div>
          </dl>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Button
            variant="default"
            className="retro-glow"
            onClick={handleTrainNow}
          >
            Queue Training Run
          </Button>
          <Button
            variant="outline"
            onClick={handleSyncNow}
          >
            Sync Feedback Now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
