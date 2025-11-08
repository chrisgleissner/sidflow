'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { classifyPath } from '@/lib/api-client';
import { formatApiError } from '@/lib/format-error';

interface ClassifyTabProps {
  onStatusChange: (status: string, isError?: boolean) => void;
}

export function ClassifyTab({ onStatusChange }: ClassifyTabProps) {
  const [path, setPath] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleClassify = async () => {
    if (!path.trim()) {
      onStatusChange('Please enter a path to classify', true);
      return;
    }

    setIsLoading(true);
    onStatusChange('Starting classification...');

    try {
      const response = await classifyPath({ path });

      if (response.success) {
        onStatusChange('Classification completed successfully');
      } else {
        onStatusChange(`Classification failed: ${formatApiError(response)}`, true);
      }
    } catch (error) {
      onStatusChange(`Failed to classify: ${error}`, true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="c64-border">
      <CardHeader>
        <CardTitle className="petscii-text text-accent">CLASSIFY</CardTitle>
        <CardDescription className="text-muted-foreground">
          Analyze and classify SID files
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="classify-path" className="text-sm font-medium">
            PATH TO CLASSIFY
          </label>
          <input
            id="classify-path"
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/path/to/sid/directory"
            className="w-full px-3 py-2 bg-input border-2 border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isLoading}
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            This will extract audio features and predict ratings for all SID files in the specified directory.
          </p>
        </div>

        <Button 
          onClick={handleClassify} 
          disabled={isLoading} 
          className="w-full retro-glow"
        >
          {isLoading ? 'CLASSIFYING...' : 'START CLASSIFICATION'}
        </Button>
      </CardContent>
    </Card>
  );
}
