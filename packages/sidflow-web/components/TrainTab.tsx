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
          <label className="text-sm font-medium">
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
          <label className="text-sm font-medium">
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

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Training improves prediction accuracy based on your manual ratings and feedback.
          </p>
        </div>

        <Button 
          onClick={handleTrain} 
          disabled={isLoading} 
          className="w-full retro-glow"
        >
          {isLoading ? 'TRAINING...' : 'START TRAINING'}
        </Button>
      </CardContent>
    </Card>
  );
}
