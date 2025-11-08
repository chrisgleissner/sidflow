'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { trainModel } from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';

interface TrainTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

export function TrainTab({ onStatusChange }: TrainTabProps) {
  const [epochs, setEpochs] = useState([10]);
  const [batchSize, setBatchSize] = useState([16]);
  const [isLoading, setIsLoading] = useState(false);

  const handleTrain = async () => {
    setIsLoading(true);
    onStatusChange('Starting model training...');

    try {
      const response = await trainModel({
        epochs: epochs[0],
        batchSize: batchSize[0],
      });

      if (response.success) {
        onStatusChange('Model training completed successfully');
      } else {
        onStatusChange(`Training failed: ${formatApiError(response)}`, true);
      }
    } catch (error) {
      onStatusChange(`Failed to train model: ${error}`, true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="c64-border">
      <CardHeader>
        <CardTitle className="petscii-text text-accent">TRAIN MODEL</CardTitle>
        <CardDescription className="text-muted-foreground">
          Train the ML model on your ratings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label
            className="text-sm font-medium cursor-help"
            title="Full passes over the training set. Higher values increase accuracy at the cost of longer runs."
          >
            EPOCHS: {epochs[0]}
          </label>
          <Slider
            value={epochs}
            onValueChange={setEpochs}
            min={1}
            max={50}
            step={1}
            disabled={isLoading}
            className="cursor-pointer"
          />
        </div>

        <div className="space-y-2">
          <label
            className="text-sm font-medium cursor-help"
            title="Number of SIDs processed per gradient update. Larger batches train faster but need more memory."
          >
            BATCH SIZE: {batchSize[0]}
          </label>
          <Slider
            value={batchSize}
            onValueChange={setBatchSize}
            min={4}
            max={64}
            step={4}
            disabled={isLoading}
            className="cursor-pointer"
          />
        </div>

        <div className="relative">
          <Button 
            onClick={handleTrain} 
            disabled={isLoading} 
            className="w-full retro-glow peer"
          >
            {isLoading ? 'TRAINING...' : 'START TRAINING'}
          </Button>
          <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 hidden w-max -translate-x-1/2 rounded bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow peer-hover:block">
            Improves the recommender by learning from your existing ratings and feedback
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
